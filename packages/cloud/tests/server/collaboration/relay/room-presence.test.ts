import { describe, expect, test } from 'bun:test'

import {
  connectTestClient,
  relaySecret,
  relayTicket,
  startTestRelay,
  until,
  user
} from '#cloud-tests/helpers/relay'
import {
  RELAY_CLOSE,
  RELAY_ROOM_PARAM,
  ROOM_PRESENCE_ACTION,
  roomPresenceSchema,
  type RoomPresence
} from '#cloud/contract'
import type { CollaborationRelay } from '#cloud/server'
import { signRoomPresenceTicket, type RoomPresenceStore } from '#cloud/server/rooms/presence'
import * as v from 'valibot'

const roomId = crypto.randomUUID()

/** Presence rows in memory, with the people a test lets into the room. */
function memoryPresence(members: string[]) {
  const allowed = new Set(members)
  const seen = new Map<string, Set<string>>()
  const store: RoomPresenceStore = {
    async seen(room, userId) {
      if (!allowed.has(userId)) return false
      const people = seen.get(room) ?? new Set()
      people.add(userId)
      seen.set(room, people)
      return true
    },
    async left(room, userId) {
      seen.get(room)?.delete(userId)
    },
    async list(room): Promise<RoomPresence> {
      return {
        people: [...(seen.get(room) ?? [])].sort().map((userId) => ({
          userId,
          name: userId,
          image: null,
          seenAt: new Date(0).toISOString()
        }))
      }
    }
  }
  return { store, allowed, seen }
}

async function ticket(userId: string, room = roomId) {
  return (await signRoomPresenceTicket(relaySecret, 'wss://cloud.test/relay', room, userId)).token
}

async function enter(hub: CollaborationRelay, userId: string, room = roomId) {
  const client = connectTestClient((socket) => hub.connect(socket))
  client.send({ type: 'auth', token: await ticket(userId, room) })
  return client
}

function lastPeople(client: ReturnType<typeof connectTestClient>): string[] {
  const last = client.messages(ROOM_PRESENCE_ACTION).at(-1)
  if (!last) return []
  const parsed = v.parse(
    v.pipe(v.string(), v.parseJson(), roomPresenceSchema),
    new TextDecoder().decode(last.payload)
  )
  return parsed.people.map((person) => person.userId)
}

describe('room presence channel', () => {
  test('names the room in the ticket URL', async () => {
    const issued = await signRoomPresenceTicket(relaySecret, 'wss://cloud.test/relay', roomId, 'a')
    expect(new URL(issued.serverURL).searchParams.get(RELAY_ROOM_PARAM)).toBe(roomId)
  })

  test('sends everyone in the room on arrivals and departures', async () => {
    const presence = memoryPresence(['alice', 'bob'])
    const { relay: hub } = startTestRelay({ roomPresence: presence.store })
    const alice = await enter(hub, 'alice')
    await until(() => lastPeople(alice).length === 1)
    expect(lastPeople(alice)).toEqual(['alice'])

    const bob = await enter(hub, 'bob')
    await until(() => lastPeople(alice).length === 2)
    expect(lastPeople(bob)).toEqual(['alice', 'bob'])

    bob.connection.closed()
    await until(() => lastPeople(alice).length === 1)
    expect(lastPeople(alice)).toEqual(['alice'])
    expect(presence.seen.get(roomId)?.has('bob')).toBe(false)
  })

  test('keeps a person in the room while another of their sockets is open', async () => {
    const presence = memoryPresence(['alice', 'bob'])
    const { relay: hub } = startTestRelay({ roomPresence: presence.store })
    const bob = await enter(hub, 'bob')
    const firstTab = await enter(hub, 'alice')
    await enter(hub, 'alice')
    await until(() => lastPeople(bob).length === 2)
    firstTab.connection.closed()
    await new Promise((resolve) => {
      setTimeout(resolve, 5)
    })
    expect(presence.seen.get(roomId)?.has('alice')).toBe(true)
  })

  test('turns away people who may not enter the room', async () => {
    const { relay: hub } = startTestRelay({ roomPresence: memoryPresence(['alice']).store })
    const mallory = await enter(hub, 'mallory')
    await until(() => mallory.closed !== null)
    expect(mallory.closed?.code).toBe(RELAY_CLOSE.unauthorized)
  })

  test('closes the socket of someone removed from the room at the next refresh', async () => {
    const presence = memoryPresence(['alice', 'bob'])
    const { relay: hub } = startTestRelay({
      roomPresence: presence.store,
      roomPresenceRefreshMs: 5
    })
    const alice = await enter(hub, 'alice')
    const bob = await enter(hub, 'bob')
    await until(() => lastPeople(alice).length === 2)
    presence.allowed.delete('bob')
    await until(() => bob.closed !== null)
    expect(bob.closed?.code).toBe(RELAY_CLOSE.unauthorized)
    await until(() => lastPeople(alice).length === 1)
  })

  test('ignores messages sent on the channel', async () => {
    const presence = memoryPresence(['alice'])
    const { relay: hub } = startTestRelay({ roomPresence: presence.store })
    const alice = await enter(hub, 'alice')
    await until(() => lastPeople(alice).length === 1)
    alice.send({
      type: 'message',
      namespace: 'yjs-update',
      target: null,
      payload: new Uint8Array()
    })
    expect(alice.closed).toBeNull()
  })

  test('turns presence tickets away without a presence store, and document tickets on a room relay', async () => {
    const { relay: plain } = startTestRelay()
    const refused = await enter(plain, 'alice')
    await until(() => refused.closed !== null)
    expect(refused.closed?.code).toBe(RELAY_CLOSE.unauthorized)

    const { relay: roomRelay } = startTestRelay({
      roomPresence: memoryPresence(['alice']).store,
      roomId
    })
    const documentPeer = connectTestClient((socket) => roomRelay.connect(socket))
    documentPeer.send({
      type: 'auth',
      token: await relayTicket({
        documentId: crypto.randomUUID(),
        permission: 'edit',
        principal: user('alice')
      })
    })
    await until(() => documentPeer.closed !== null)
    expect(documentPeer.closed?.code).toBe(RELAY_CLOSE.unauthorized)

    const otherRoom = await enter(roomRelay, 'alice', crypto.randomUUID())
    await until(() => otherRoom.closed !== null)
    expect(otherRoom.closed?.code).toBe(RELAY_CLOSE.unauthorized)
  })
})
