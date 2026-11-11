import {
  RELAY_ROOM_PARAM,
  ROOM_PRESENCE_WINDOW_MS,
  type RoomPresence,
  type RoomPresenceTicket
} from '#cloud/contract'
import { dateString } from '#cloud/server/sharing/contracts'
import { jwtVerify, SignJWT } from 'jose'
import { withQuery } from 'ufo'
import * as v from 'valibot'

import type { RoomDatabase } from './access'
import { RoomNotFoundError } from './errors'
import { requireRoom } from './guard'

/** How long a presence ticket admits its holder to the relay; the socket then reconnects. */
const PRESENCE_TICKET_LIFETIME_SECONDS = 10 * 60

/** Marks a presence ticket, so it can never pass as a document's collaboration ticket. */
const PRESENCE_TICKET_PURPOSE = 'room-presence'

const presenceClaimsSchema = v.object({
  purpose: v.literal(PRESENCE_TICKET_PURPOSE),
  roomId: v.pipe(v.string(), v.uuid()),
  userId: v.pipe(v.string(), v.minLength(1)),
  exp: v.pipe(v.number(), v.integer())
})

/** Who a presence ticket admits to which room's presence channel. */
export type RoomPresenceAuthorization = {
  roomId: string
  userId: string
  /** When the ticket stops being valid, in milliseconds since the epoch. */
  expiresAt: number
}

/** Signs a ticket for the relay's presence channel of a room the person may enter. */
export async function signRoomPresenceTicket(
  authSecret: string,
  relayURL: string,
  roomId: string,
  userId: string
): Promise<RoomPresenceTicket> {
  const issuedAt = Math.floor(Date.now() / 1000)
  const expiresAtSeconds = issuedAt + PRESENCE_TICKET_LIFETIME_SECONDS
  const token = await new SignJWT({ purpose: PRESENCE_TICKET_PURPOSE, roomId, userId })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt(issuedAt)
    .setExpirationTime(expiresAtSeconds)
    .setSubject(userId)
    .sign(new TextEncoder().encode(authSecret))
  return {
    token,
    serverURL: withQuery(relayURL, { [RELAY_ROOM_PARAM]: roomId }),
    expiresAt: new Date(expiresAtSeconds * 1000).toISOString()
  }
}

/** Verifies a presence ticket; throws for anything else, a document's tickets included. */
export async function authorizeRoomPresenceTicket(
  token: string,
  authSecret: string
): Promise<RoomPresenceAuthorization> {
  const verified = await jwtVerify(token, new TextEncoder().encode(authSecret), {
    algorithms: ['HS256']
  })
  const claims = v.parse(presenceClaimsSchema, verified.payload)
  return { roomId: claims.roomId, userId: claims.userId, expiresAt: claims.exp * 1000 }
}

/** Who checked in to a room within `ROOM_PRESENCE_WINDOW_MS`, by name. */
export async function listRoomPresence(
  database: RoomDatabase,
  roomId: string
): Promise<RoomPresence> {
  const rows = await database
    .selectFrom('roomPresence')
    .innerJoin('user', (join) =>
      join.on((expression) =>
        expression(
          expression.cast(expression.ref('user.id'), 'text'),
          '=',
          expression.ref('roomPresence.userId')
        )
      )
    )
    .select(['roomPresence.userId', 'roomPresence.seenAt', 'user.name', 'user.image'])
    .where('roomPresence.roomId', '=', roomId)
    .where('roomPresence.seenAt', '>', new Date(Date.now() - ROOM_PRESENCE_WINDOW_MS))
    .orderBy('user.name')
    .execute()
  return {
    people: rows.map((row) => ({
      userId: row.userId,
      name: row.name,
      image: row.image,
      seenAt: dateString(row.seenAt) ?? ''
    }))
  }
}

/** Records that the person is in the room now. */
export async function recordRoomPresence(
  database: RoomDatabase,
  roomId: string,
  userId: string
): Promise<void> {
  const seenAt = new Date()
  await database
    .insertInto('roomPresence')
    .values({ roomId, userId, seenAt })
    .onConflict((conflict) => conflict.columns(['roomId', 'userId']).doUpdateSet({ seenAt }))
    .execute()
}

export async function forgetRoomPresence(
  database: RoomDatabase,
  roomId: string,
  userId: string
): Promise<void> {
  await database
    .deleteFrom('roomPresence')
    .where('roomId', '=', roomId)
    .where('userId', '=', userId)
    .execute()
}

/** What the relay's presence channel reads and writes: the same rows polling check-ins use. */
export type RoomPresenceStore = {
  /** Records the person in the room; false once they may no longer enter it. */
  seen(roomId: string, userId: string): Promise<boolean>
  left(roomId: string, userId: string): Promise<void>
  list(roomId: string): Promise<RoomPresence>
}

export function createRoomPresenceStore(database: RoomDatabase): RoomPresenceStore {
  return {
    async seen(roomId, userId) {
      try {
        await requireRoom(database, userId, roomId)
      } catch (error) {
        if (error instanceof RoomNotFoundError) {
          await forgetRoomPresence(database, roomId, userId)
          return false
        }
        throw error
      }
      await recordRoomPresence(database, roomId, userId)
      return true
    },
    left: (roomId, userId) => forgetRoomPresence(database, roomId, userId),
    list: (roomId) => listRoomPresence(database, roomId)
  }
}
