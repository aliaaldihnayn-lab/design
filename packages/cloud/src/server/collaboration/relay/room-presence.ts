import {
  RELAY_CLOSE,
  RELAY_SERVER_PEER,
  ROOM_PRESENCE_ACTION,
  ROOM_PRESENCE_INTERVAL_MS,
  relayServerMessages,
  type RoomPresence
} from '#cloud/contract'
import type { RoomPresenceAuthorization, RoomPresenceStore } from '#cloud/server/rooms/presence'

import type { RelaySocket } from './hub'

type PresencePeer = {
  id: string
  socket: RelaySocket
  authorization: RoomPresenceAuthorization
  expiry?: ReturnType<typeof setTimeout>
}

type PresenceRoom = {
  roomId: string
  peers: Map<string, PresencePeer>
  refresh: ReturnType<typeof setTimeout> | null
}

export type RoomPresenceRelayOptions = {
  store: RoomPresenceStore
  /** How often the check-ins of connected people are renewed and the room is sent again. */
  refreshMs?: number
  report: (message: string, error: unknown) => void
}

/** A peer on a room's presence channel, as the hub keeps it for its socket. */
export type RoomPresenceMember = {
  /** A refreshed ticket for the same person and room keeps the socket open longer. */
  renew(authorization: RoomPresenceAuthorization): boolean
  leave(): void
}

/**
 * The relay's live presence channels, one per room. Each socket on one is a person in the
 * room: the relay records them in the same rows that polling check-ins write, renews those while
 * the socket stays open, and sends everyone on the channel who is in the room whenever someone
 * arrives or leaves and at every refresh, which also brings in people who only check in.
 */
export function createRoomPresenceRelay(options: RoomPresenceRelayOptions) {
  const rooms = new Map<string, PresenceRoom>()
  const refreshMs = options.refreshMs ?? ROOM_PRESENCE_INTERVAL_MS

  function encode(presence: RoomPresence): Uint8Array<ArrayBuffer>[] {
    return relayServerMessages({
      type: 'message',
      namespace: ROOM_PRESENCE_ACTION,
      from: RELAY_SERVER_PEER,
      payload: new TextEncoder().encode(JSON.stringify(presence))
    })
  }

  async function broadcast(room: PresenceRoom) {
    if (room.peers.size === 0) return
    const messages = encode(await options.store.list(room.roomId))
    for (const peer of room.peers.values())
      for (const message of messages) peer.socket.send(message)
  }

  function scheduleRefresh(room: PresenceRoom) {
    room.refresh = setTimeout(() => {
      room.refresh = null
      void refresh(room)
    }, refreshMs)
  }

  async function refresh(room: PresenceRoom) {
    if (rooms.get(room.roomId) !== room) return
    try {
      const userIds = new Set([...room.peers.values()].map((peer) => peer.authorization.userId))
      for (const userId of userIds) {
        if (await options.store.seen(room.roomId, userId)) continue
        // Someone removed from the room stops seeing who is in it.
        for (const peer of room.peers.values()) {
          if (peer.authorization.userId !== userId) continue
          peer.socket.close(RELAY_CLOSE.unauthorized, 'No longer a member of the room')
          depart(room, peer)
        }
      }
      await broadcast(room)
    } catch (error) {
      options.report('Refreshing room presence failed:', error)
    }
    if (rooms.get(room.roomId) === room && room.peers.size > 0) scheduleRefresh(room)
  }

  function scheduleExpiry(peer: PresencePeer) {
    clearTimeout(peer.expiry)
    peer.expiry = setTimeout(
      () => peer.socket.close(RELAY_CLOSE.expired, 'Presence ticket expired'),
      Math.max(0, peer.authorization.expiresAt - Date.now())
    )
  }

  function depart(room: PresenceRoom, peer: PresencePeer) {
    clearTimeout(peer.expiry)
    if (!room.peers.delete(peer.id)) return
    const { userId } = peer.authorization
    const stillHere = [...room.peers.values()].some(
      (other) => other.authorization.userId === userId
    )
    if (room.peers.size === 0) {
      if (room.refresh) clearTimeout(room.refresh)
      rooms.delete(room.roomId)
    }
    if (stillHere) return
    void options.store
      .left(room.roomId, userId)
      .then(() => broadcast(room))
      .catch((error: unknown) => options.report('Recording a room departure failed:', error))
  }

  return {
    /** Adds the socket to its room's channel; null when the person may no longer enter it. */
    async admit(
      socket: RelaySocket,
      authorization: RoomPresenceAuthorization
    ): Promise<RoomPresenceMember | null> {
      if (!(await options.store.seen(authorization.roomId, authorization.userId))) {
        socket.close(RELAY_CLOSE.unauthorized, 'Not a member of the room')
        return null
      }
      let room = rooms.get(authorization.roomId)
      if (!room) {
        room = { roomId: authorization.roomId, peers: new Map(), refresh: null }
        rooms.set(room.roomId, room)
        scheduleRefresh(room)
      }
      const joined = room
      const peer: PresencePeer = { id: crypto.randomUUID(), socket, authorization }
      joined.peers.set(peer.id, peer)
      scheduleExpiry(peer)
      await broadcast(joined)
      return {
        renew(next) {
          if (
            next.roomId !== peer.authorization.roomId ||
            next.userId !== peer.authorization.userId
          )
            return false
          peer.authorization = next
          scheduleExpiry(peer)
          return true
        },
        leave: () => depart(joined, peer)
      }
    },

    /** Closes every presence socket, as the runtime shuts down. */
    close() {
      for (const room of rooms.values()) {
        if (room.refresh) clearTimeout(room.refresh)
        for (const peer of room.peers.values()) {
          clearTimeout(peer.expiry)
          peer.socket.close(1001, 'Server shutting down')
        }
        room.peers.clear()
      }
      rooms.clear()
    }
  }
}
