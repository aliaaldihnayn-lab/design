import type {
  CreateDocumentInput,
  CreateRoomInput,
  DocumentSummary,
  MoveRoomInput,
  RoomAudit,
  RoomDetail,
  RoomFile,
  RoomPresence,
  RoomPresenceTicket,
  RoomSummary,
  UpdateRoomInput
} from '#cloud/contract'
import type { CloudDatabase } from '#cloud/server/db'
import { canEditDocument, resolveDocumentAccess } from '#cloud/server/documents/access'
import { workspaceRole } from '#cloud/server/documents/repository'
import { documentSummary, getDocumentSummaryRow } from '#cloud/server/documents/summary'
import { dateString } from '#cloud/server/sharing/contracts'
import { countBy } from 'es-toolkit'
import type { Kysely, Updateable } from 'kysely'

import {
  effectiveRoomRole,
  loadRoomGraph,
  roomAncestors,
  roomIsArchived,
  roomSubtree,
  workspacesWithRooms,
  type RoomDatabase,
  type RoomGraph,
  type RoomRoleMemo
} from './access'
import { endRoomSessions, listRoomEvents, recordRoomEvent } from './audit'
import { RoomInvalidError, RoomNotFoundError } from './errors'
import { requireRoom } from './guard'
import {
  forgetRoomPresence,
  listRoomPresence,
  recordRoomPresence,
  signRoomPresenceTicket
} from './presence'

const WORKSPACE_WRITERS = new Set(['admin', 'editor'])

/** The columns an update sets, leaving out what it does not mention. */
function roomChanges(input: UpdateRoomInput): Updateable<CloudDatabase['room']> {
  const changes: Updateable<CloudDatabase['room']> = { updatedAt: new Date() }
  if (input.name !== undefined) changes.name = input.name
  if (input.accessMode !== undefined) changes.accessMode = input.accessMode
  if (input.archived !== undefined) changes.archivedAt = input.archived ? new Date() : null
  return changes
}

/** The rooms' summaries for one person; a parent they cannot enter shows as no parent. */
export async function roomSummaries(
  database: RoomDatabase,
  graph: RoomGraph,
  roomIds: string[]
): Promise<RoomSummary[]> {
  if (roomIds.length === 0) return []
  const rows = await database
    .selectFrom('room')
    .select(['id', 'createdAt', 'updatedAt'])
    .where('id', 'in', roomIds)
    .execute()
  const owners = await database
    .selectFrom('roomMember')
    .select(['roomId', 'userId'])
    .where('roomId', 'in', roomIds)
    .where('role', '=', 'owner')
    .execute()
  const files = await database
    .selectFrom('roomFile')
    .innerJoin('document', 'document.id', 'roomFile.documentId')
    .select('roomFile.roomId')
    .where('roomFile.roomId', 'in', roomIds)
    .where('document.deletedAt', 'is', null)
    .execute()
  const fileCounts = countBy(files, (file) => file.roomId)
  const ownerOf = new Map(owners.map((owner) => [owner.roomId, owner.userId]))
  const memo: RoomRoleMemo = new Map()
  const summaries: RoomSummary[] = []
  for (const row of rows) {
    const room = graph.rooms.get(row.id)
    const role = effectiveRoomRole(graph, row.id, memo)
    if (!room || !role) continue
    const parentVisible =
      room.parentId !== null && effectiveRoomRole(graph, room.parentId, memo) !== undefined
    summaries.push({
      id: room.id,
      workspaceId: room.workspaceId,
      parentId: parentVisible ? room.parentId : null,
      name: room.name,
      accessMode: room.accessMode,
      role,
      ownerId: ownerOf.get(room.id) ?? '',
      fileCount: fileCounts[room.id] ?? 0,
      createdAt: dateString(row.createdAt) ?? '',
      updatedAt: dateString(row.updatedAt) ?? '',
      archivedAt: dateString(room.archivedAt)
    })
  }
  return summaries.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
}

/**
 * Rooms and the files in them. Every operation checks the person's role in the room on the
 * server; someone who may not enter a room is told it does not exist.
 */
export function createRoomService(
  database: Kysely<CloudDatabase>,
  options: { authSecret?: string; relayURL?: string } = {}
) {
  async function summary(userId: string, roomId: string): Promise<RoomSummary> {
    const { graph } = await requireRoom(database, userId, roomId)
    const [room] = await roomSummaries(database, graph, [roomId])
    if (!room) throw new RoomNotFoundError()
    return room
  }

  return {
    /** Every room the person may enter, across their workspaces, without archived ones. */
    async tree(userId: string, options: { archived?: boolean } = {}): Promise<RoomSummary[]> {
      const graph = await loadRoomGraph(
        database,
        userId,
        await workspacesWithRooms(database, userId)
      )
      const memo: RoomRoleMemo = new Map()
      const visible = [...graph.rooms.keys()].filter(
        (roomId) =>
          effectiveRoomRole(graph, roomId, memo) !== undefined &&
          (options.archived === true || !roomIsArchived(graph, roomId))
      )
      return roomSummaries(database, graph, visible)
    },

    async get(userId: string, roomId: string): Promise<RoomDetail> {
      const { graph } = await requireRoom(database, userId, roomId)
      const memo: RoomRoleMemo = new Map()
      const path: RoomDetail['path'] = []
      for (const ancestor of roomAncestors(graph, roomId)) {
        if (!effectiveRoomRole(graph, ancestor.id, memo)) break
        path.unshift({ id: ancestor.id, name: ancestor.name })
      }
      const childIds = (graph.children.get(roomId) ?? []).filter(
        (childId) =>
          effectiveRoomRole(graph, childId, memo) !== undefined &&
          graph.rooms.get(childId)?.archivedAt === null
      )
      const summaries = await roomSummaries(database, graph, [roomId, ...childIds])
      const room = summaries.find((entry) => entry.id === roomId)
      if (!room) throw new RoomNotFoundError()
      const children = summaries.filter((entry) => entry.id !== roomId)
      const fileRows = await database
        .selectFrom('roomFile')
        .innerJoin('document', 'document.id', 'roomFile.documentId')
        .select([
          'document.id',
          'document.workspaceId',
          'document.name',
          'document.kind',
          'document.currentRevisionId',
          'document.version',
          'document.createdAt',
          'document.updatedAt',
          'roomFile.addedBy',
          'roomFile.addedAt'
        ])
        .where('roomFile.roomId', '=', roomId)
        .where('document.deletedAt', 'is', null)
        .orderBy('document.updatedAt', 'desc')
        .execute()
      const files: RoomFile[] = fileRows.map(({ addedBy, addedAt, ...document }) => ({
        document: documentSummary(document),
        addedBy,
        addedAt: dateString(addedAt) ?? ''
      }))
      return { room, path, children, files }
    },

    /**
     * Makes a top-level room in a workspace the person may write in, or a sub-room of one they
     * edit; whoever makes it owns it.
     */
    async create(userId: string, input: CreateRoomInput): Promise<RoomSummary> {
      let workspaceId: string
      const parentId = input.parentId ?? null
      if (parentId) {
        const parent = await requireRoom(database, userId, parentId, 'editor')
        workspaceId = parent.room.workspaceId
        if (input.workspaceId && input.workspaceId !== workspaceId) {
          throw new RoomInvalidError('other-workspace')
        }
      } else {
        if (!input.workspaceId) throw new RoomNotFoundError()
        const role = await workspaceRole(database, userId, input.workspaceId)
        if (!role || !WORKSPACE_WRITERS.has(role)) throw new RoomNotFoundError()
        if (input.accessMode === 'inherit') throw new RoomInvalidError('top-level-inherit')
        workspaceId = input.workspaceId
      }
      const id = crypto.randomUUID()
      const accessMode = parentId ? (input.accessMode ?? 'inherit') : 'restricted'
      await database.transaction().execute(async (transaction) => {
        await transaction
          .insertInto('room')
          .values({ id, workspaceId, parentId, name: input.name, accessMode, createdBy: userId })
          .execute()
        await transaction
          .insertInto('roomMember')
          .values({ roomId: id, userId, role: 'owner', addedBy: userId })
          .execute()
        await recordRoomEvent(transaction, {
          roomId: id,
          actorUserId: userId,
          action: 'room-created',
          metadata: { parentId, accessMode }
        })
      })
      return summary(userId, id)
    },

    /** Renames (editors), changes who may enter or archives (owner only). */
    async update(userId: string, roomId: string, input: UpdateRoomInput): Promise<RoomSummary> {
      if (
        input.name === undefined &&
        input.accessMode === undefined &&
        input.archived === undefined
      ) {
        throw new RoomInvalidError('empty-update')
      }
      const ownerOnly = input.accessMode !== undefined || input.archived !== undefined
      const { room, graph } = await requireRoom(
        database,
        userId,
        roomId,
        ownerOnly ? 'owner' : 'editor'
      )
      if (input.accessMode === 'inherit' && room.parentId === null) {
        throw new RoomInvalidError('top-level-inherit')
      }
      await database.transaction().execute(async (transaction) => {
        await transaction
          .updateTable('room')
          .set(roomChanges(input))
          .where('id', '=', roomId)
          .execute()
        if (input.accessMode !== undefined && input.accessMode !== room.accessMode) {
          await recordRoomEvent(transaction, {
            roomId,
            actorUserId: userId,
            action: 'access-changed',
            metadata: { from: room.accessMode, to: input.accessMode }
          })
          await endRoomSessions(transaction, roomSubtree(graph, roomId))
        }
        if (input.archived !== undefined && input.archived !== (room.archivedAt !== null)) {
          await recordRoomEvent(transaction, {
            roomId,
            actorUserId: userId,
            action: input.archived ? 'room-archived' : 'room-restored'
          })
        }
      })
      return summary(userId, roomId)
    },

    /**
     * Moves a room, with everything under it, beneath another room of the same workspace that the
     * person edits, or to the top level of a workspace they write in, where it keeps to its own
     * member list.
     */
    async move(userId: string, roomId: string, input: MoveRoomInput): Promise<RoomSummary> {
      const { room, graph } = await requireRoom(database, userId, roomId, 'owner')
      if (input.parentId === room.parentId) return summary(userId, roomId)
      if (input.parentId) {
        const parent = await requireRoom(database, userId, input.parentId, 'editor')
        if (parent.room.workspaceId !== room.workspaceId) {
          throw new RoomInvalidError('other-workspace')
        }
        if (roomSubtree(graph, roomId).includes(input.parentId)) throw new RoomInvalidError('cycle')
      } else {
        const role = await workspaceRole(database, userId, room.workspaceId)
        if (!role || !WORKSPACE_WRITERS.has(role)) throw new RoomNotFoundError()
      }
      await database.transaction().execute(async (transaction) => {
        await transaction
          .updateTable('room')
          .set({
            parentId: input.parentId,
            ...(input.parentId === null ? { accessMode: 'restricted' as const } : {}),
            updatedAt: new Date()
          })
          .where('id', '=', roomId)
          .execute()
        await recordRoomEvent(transaction, {
          roomId,
          actorUserId: userId,
          action: 'room-moved',
          metadata: { from: room.parentId, to: input.parentId }
        })
        await endRoomSessions(transaction, roomSubtree(graph, roomId))
      })
      return summary(userId, roomId)
    },

    /**
     * Puts a document of the room's workspace in the room, taking it out of any room it was in.
     * The person must be able to edit the document and edit both rooms.
     */
    async addFile(userId: string, roomId: string, documentId: string): Promise<RoomFile> {
      const { room } = await requireRoom(database, userId, roomId, 'editor')
      const access = await resolveDocumentAccess(database, userId, documentId)
      const document = await getDocumentSummaryRow(database, documentId)
      if (!access || !document) throw new RoomNotFoundError()
      if (!canEditDocument(access)) throw new RoomNotFoundError()
      if (document.workspaceId !== room.workspaceId) throw new RoomInvalidError('other-workspace')
      const current = await database
        .selectFrom('roomFile')
        .select('roomId')
        .where('documentId', '=', documentId)
        .executeTakeFirst()
      if (current && current.roomId !== roomId) {
        await requireRoom(database, userId, current.roomId, 'editor')
      }
      const addedAt = new Date()
      await database.transaction().execute(async (transaction) => {
        await transaction
          .insertInto('roomFile')
          .values({ documentId, roomId, addedBy: userId, addedAt })
          .onConflict((conflict) =>
            conflict.column('documentId').doUpdateSet({ roomId, addedBy: userId, addedAt })
          )
          .execute()
        // Who may open it changed, so its open sessions start over under the new room.
        await transaction
          .updateTable('document')
          .set({ collaborationEpoch: (expression) => expression('collaborationEpoch', '+', 1) })
          .where('id', '=', documentId)
          .execute()
      })
      return {
        document: documentSummary(document),
        addedBy: userId,
        addedAt: addedAt.toISOString()
      }
    },

    /** Takes a document out of a room, back to its workspace. */
    async removeFile(userId: string, roomId: string, documentId: string): Promise<void> {
      await requireRoom(database, userId, roomId, 'editor')
      await database.transaction().execute(async (transaction) => {
        const result = await transaction
          .deleteFrom('roomFile')
          .where('roomId', '=', roomId)
          .where('documentId', '=', documentId)
          .executeTakeFirst()
        if (Number(result.numDeletedRows) === 0) throw new RoomNotFoundError()
        await transaction
          .updateTable('document')
          .set({ collaborationEpoch: (expression) => expression('collaborationEpoch', '+', 1) })
          .where('id', '=', documentId)
          .execute()
      })
    },

    /** Makes a new document straight in a room, in the room's workspace. */
    async createDocument(
      userId: string,
      roomId: string,
      input: CreateDocumentInput
    ): Promise<DocumentSummary> {
      const { room } = await requireRoom(database, userId, roomId, 'editor')
      const documentId = input.id ?? crypto.randomUUID()
      await database.transaction().execute(async (transaction) => {
        await transaction
          .insertInto('document')
          .values({
            id: documentId,
            workspaceId: room.workspaceId,
            name: input.name,
            kind: input.kind,
            createdBy: userId
          })
          .execute()
        await transaction
          .insertInto('roomFile')
          .values({ documentId, roomId, addedBy: userId })
          .execute()
      })
      const row = await getDocumentSummaryRow(database, documentId)
      if (!row) throw new RoomNotFoundError()
      return documentSummary(row)
    },

    async audit(userId: string, roomId: string): Promise<RoomAudit> {
      await requireRoom(database, userId, roomId, 'owner')
      return listRoomEvents(database, roomId)
    },

    /** Records that the person is in the room now, and answers who else is. */
    async heartbeat(userId: string, roomId: string): Promise<RoomPresence> {
      await requireRoom(database, userId, roomId)
      await recordRoomPresence(database, roomId, userId)
      return listRoomPresence(database, roomId)
    },

    async presence(userId: string, roomId: string): Promise<RoomPresence> {
      await requireRoom(database, userId, roomId)
      return listRoomPresence(database, roomId)
    },

    /**
     * A ticket for the relay's live presence channel of the room, which replaces check-ins while
     * its socket is open; without a relay there is none, and clients keep checking in.
     */
    async presenceTicket(userId: string, roomId: string): Promise<RoomPresenceTicket> {
      await requireRoom(database, userId, roomId)
      if (!options.authSecret || !options.relayURL) throw new RoomNotFoundError()
      return signRoomPresenceTicket(options.authSecret, options.relayURL, roomId, userId)
    },

    /** The person left the room's page. */
    async leavePresence(userId: string, roomId: string): Promise<void> {
      await forgetRoomPresence(database, roomId, userId)
    }
  }
}

export type RoomService = ReturnType<typeof createRoomService>
