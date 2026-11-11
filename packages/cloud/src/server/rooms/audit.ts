import type { RoomAudit, RoomAuditAction } from '#cloud/contract'
import { dateString } from '#cloud/server/sharing/contracts'

import type { RoomDatabase } from './access'

export type RoomEventInput = {
  roomId: string
  actorUserId: string
  action: RoomAuditAction
  subjectUserId?: string | null
  subjectEmail?: string | null
  metadata?: Record<string, unknown>
}

/** Appends to a room's audit trail; nothing ever changes or removes an entry. */
export async function recordRoomEvent(
  database: RoomDatabase,
  event: RoomEventInput
): Promise<void> {
  await database
    .insertInto('roomAuditEvent')
    .values({
      id: crypto.randomUUID(),
      roomId: event.roomId,
      actorUserId: event.actorUserId,
      action: event.action,
      subjectUserId: event.subjectUserId ?? null,
      subjectEmail: event.subjectEmail ?? null,
      metadata: event.metadata ?? {}
    })
    .execute()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export async function listRoomEvents(
  database: RoomDatabase,
  roomId: string,
  limit = 200
): Promise<RoomAudit> {
  const rows = await database
    .selectFrom('roomAuditEvent')
    .leftJoin('user', (join) =>
      join.on((expression) =>
        expression(
          expression.cast(expression.ref('user.id'), 'text'),
          '=',
          expression.ref('roomAuditEvent.actorUserId')
        )
      )
    )
    .select([
      'roomAuditEvent.id',
      'roomAuditEvent.action',
      'roomAuditEvent.actorUserId',
      'roomAuditEvent.subjectUserId',
      'roomAuditEvent.subjectEmail',
      'roomAuditEvent.metadata',
      'roomAuditEvent.createdAt',
      'user.name as actorName'
    ])
    .where('roomAuditEvent.roomId', '=', roomId)
    .orderBy('roomAuditEvent.createdAt', 'desc')
    .orderBy('roomAuditEvent.id')
    .limit(limit)
    .execute()
  return {
    events: rows.map((row) => ({
      id: row.id,
      action: row.action,
      actor: { id: row.actorUserId, name: row.actorName },
      subjectUserId: row.subjectUserId,
      subjectEmail: row.subjectEmail,
      metadata: isRecord(row.metadata) ? row.metadata : {},
      createdAt: dateString(row.createdAt) ?? ''
    }))
  }
}

/**
 * Ends the live collaboration sessions of every document in these rooms, so someone whose access
 * just went away is also dropped from the documents they had open.
 */
export async function endRoomSessions(database: RoomDatabase, roomIds: string[]): Promise<void> {
  if (roomIds.length === 0) return
  await database
    .updateTable('document')
    .set({ collaborationEpoch: (expression) => expression('collaborationEpoch', '+', 1) })
    .where('id', 'in', (query) =>
      query
        .selectFrom('roomFile')
        .select('roomFile.documentId')
        .where('roomFile.roomId', 'in', roomIds)
    )
    .execute()
}
