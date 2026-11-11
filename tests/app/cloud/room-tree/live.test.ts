import { describe, expect, test } from 'bun:test'

import {
  createRelayClientAssembler,
  decodeRelayClientFrame,
  RELAY_CLOSE,
  RELAY_SERVER_PEER,
  relayServerMessages,
  ROOM_PRESENCE_ACTION,
  type RelayClientFrame,
  type RelayServerFrame,
  type RoomPresence
} from '@lawha/cloud/contract'

import { connectRoomPresence } from '@/app/cloud/room-tree/live'

import { asDouble } from '#tests/helpers/doubles'

class FakeSocket extends EventTarget {
  binaryType = 'blob'
  readonly sent: RelayClientFrame[] = []
  closedWith: number | null = null
  private readonly assembler = createRelayClientAssembler(() => Infinity)

  send(data: Uint8Array) {
    const assembled = this.assembler.push(data)
    const frame = assembled.type === 'frame' ? decodeRelayClientFrame(assembled.data) : null
    if (frame) this.sent.push(frame)
  }

  open() {
    this.dispatchEvent(new Event('open'))
  }

  receive(frame: RelayServerFrame) {
    for (const data of relayServerMessages(frame)) {
      this.dispatchEvent(new MessageEvent('message', { data: data.slice().buffer }))
    }
  }

  close(code = 1000) {
    this.closedWith = code
    this.dispatchEvent(new CloseEvent('close', { code }))
  }
}

const ticket = {
  token: 'presence-ticket',
  serverURL: 'wss://cloud.test/api/collaboration/relay?room=r',
  expiresAt: new Date(0).toISOString()
}

function presence(...names: string[]): RoomPresence {
  return {
    people: names.map((name) => ({ userId: name, name, image: null, seenAt: '' }))
  }
}

function presenceFrame(value: RoomPresence, from = RELAY_SERVER_PEER): RelayServerFrame {
  return {
    type: 'message',
    namespace: ROOM_PRESENCE_ACTION,
    from,
    payload: new TextEncoder().encode(JSON.stringify(value))
  }
}

function open() {
  const socket = new FakeSocket()
  const received: RoomPresence[] = []
  const closes: string[] = []
  let url = ''
  const channel = connectRoomPresence({
    ticket,
    createSocket(address) {
      url = address
      return asDouble<WebSocket>(socket)
    },
    onPresence: (value) => received.push(value),
    onClosed: (reason) => closes.push(reason)
  })
  return { socket, received, closes, channel, url: () => url }
}

describe('room presence channel', () => {
  test('presents its ticket and reports who is in the room', () => {
    const { socket, received, url } = open()
    expect(url()).toBe(ticket.serverURL)
    socket.open()
    expect(socket.sent).toEqual([{ type: 'auth', token: ticket.token }])
    socket.receive(presenceFrame(presence('Alice', 'Bob')))
    expect(received.at(-1)?.people.map((person) => person.name)).toEqual(['Alice', 'Bob'])
  })

  test('ignores what does not come from the relay, other channels, and malformed messages', () => {
    const { socket, received } = open()
    socket.open()
    socket.receive(presenceFrame(presence('Mallory'), 'some-peer'))
    socket.receive({
      type: 'message',
      namespace: 'awareness',
      from: RELAY_SERVER_PEER,
      payload: new Uint8Array()
    })
    socket.receive({
      type: 'message',
      namespace: ROOM_PRESENCE_ACTION,
      from: RELAY_SERVER_PEER,
      payload: new TextEncoder().encode('{"people": 3}')
    })
    expect(received).toEqual([])
  })

  test('tells an expired ticket from a failure, and stays quiet once closed by the page', () => {
    const expired = open()
    expired.socket.close(RELAY_CLOSE.expired)
    expect(expired.closes).toEqual(['expired'])

    const failed = open()
    failed.socket.close(1006)
    expect(failed.closes).toEqual(['failed'])

    const left = open()
    left.channel.close()
    expect(left.socket.closedWith).toBe(1000)
    expect(left.closes).toEqual([])
  })
})
