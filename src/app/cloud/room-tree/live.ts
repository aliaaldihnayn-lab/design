import * as v from 'valibot'

import {
  createRelayServerAssembler,
  decodeRelayServerFrame,
  RELAY_CLOSE,
  RELAY_SERVER_PEER,
  relayClientMessages,
  ROOM_PRESENCE_ACTION,
  roomPresenceSchema,
  type RoomPresence,
  type RoomPresenceTicket
} from '@lawha/cloud/contract'

/** The most one presence message may hold: a room's people fit far within it. */
const MAXIMUM_PRESENCE_BYTES = 1024 * 1024

const presenceMessageSchema = v.pipe(v.string(), v.parseJson(), roomPresenceSchema)

export type RoomPresenceSocketOptions = {
  ticket: RoomPresenceTicket
  /** Who is in the room, each time the relay says so. */
  onPresence: (presence: RoomPresence) => void
  /**
   * The channel closed; `expired` when only its ticket ran out, so a new one reconnects at once,
   * rather than after a pause for a relay that is down or refuses the ticket.
   */
  onClosed: (reason: 'expired' | 'failed') => void
  createSocket?: (url: string) => WebSocket
}

/**
 * Opens the relay's live presence channel of one room: the socket presents its ticket and then
 * only listens, and the relay sends who is in the room whenever that changes.
 */
export function connectRoomPresence(options: RoomPresenceSocketOptions) {
  const createSocket = options.createSocket ?? ((url: string) => new WebSocket(url))
  const socket = createSocket(options.ticket.serverURL)
  socket.binaryType = 'arraybuffer'
  let closed = false
  const assembler = createRelayServerAssembler(() => MAXIMUM_PRESENCE_BYTES)

  socket.addEventListener('open', () => {
    if (closed) return
    for (const message of relayClientMessages({ type: 'auth', token: options.ticket.token })) {
      socket.send(message)
    }
  })
  socket.addEventListener('message', (event: MessageEvent<ArrayBuffer>) => {
    if (closed) return
    const assembled = assembler.push(new Uint8Array(event.data))
    if (assembled.type === 'partial') return
    const frame = assembled.type === 'frame' ? decodeRelayServerFrame(assembled.data) : null
    if (
      frame?.type !== 'message' ||
      frame.namespace !== ROOM_PRESENCE_ACTION ||
      frame.from !== RELAY_SERVER_PEER
    ) {
      return
    }
    const parsed = v.safeParse(presenceMessageSchema, new TextDecoder().decode(frame.payload))
    if (parsed.success) options.onPresence(parsed.output)
  })
  socket.addEventListener('close', (event) => {
    if (closed) return
    closed = true
    options.onClosed(event.code === RELAY_CLOSE.expired ? 'expired' : 'failed')
  })

  return {
    close() {
      if (closed) return
      closed = true
      socket.close(1000, 'Left the room')
    }
  }
}
