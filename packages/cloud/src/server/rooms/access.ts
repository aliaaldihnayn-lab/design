import type { RoomAccessMode, RoomRole } from '#cloud/contract'
import type { CloudDatabase } from '#cloud/server/db'
import type { Kysely, Transaction } from 'kysely'

export type RoomDatabase = Kysely<CloudDatabase> | Transaction<CloudDatabase>

/** A room as access decisions need it. */
export type RoomNode = {
  id: string
  workspaceId: string
  parentId: string | null
  name: string
  accessMode: RoomAccessMode
  archivedAt: Date | string | null
}

/**
 * The rooms of some workspaces with one person's own memberships in them, from which every room's
 * effective role for that person follows.
 */
export type RoomGraph = {
  rooms: Map<string, RoomNode>
  /** The person's role on each room's own list. */
  direct: Map<string, RoomRole>
  children: Map<string, string[]>
}

/** Roles already worked out for one person, shared across lookups in one graph. */
export type RoomRoleMemo = Map<string, RoomRole | undefined>

const ROLE_WEIGHT: Record<RoomRole, number> = { viewer: 1, editor: 2, owner: 3 }

export function roomRoleAtLeast(role: RoomRole | undefined, minimum: RoomRole): boolean {
  return role !== undefined && ROLE_WEIGHT[role] >= ROLE_WEIGHT[minimum]
}

function higher(a: RoomRole | undefined, b: RoomRole | undefined): RoomRole | undefined {
  if (!a) return b
  if (!b) return a
  return ROLE_WEIGHT[a] >= ROLE_WEIGHT[b] ? a : b
}

export function buildRoomGraph(rooms: RoomNode[], direct: Map<string, RoomRole>): RoomGraph {
  const children = new Map<string, string[]>()
  for (const room of rooms) {
    if (!room.parentId) continue
    const siblings = children.get(room.parentId) ?? []
    siblings.push(room.id)
    children.set(room.parentId, siblings)
  }
  return { rooms: new Map(rooms.map((room) => [room.id, room])), direct, children }
}

/**
 * The role someone has in a room. Their own list entry counts; a sub-room set to `inherit` also
 * lets in everyone its parent does, with the parent's role; and whoever owns a room runs every
 * room under it, restricted or not, so an owner always decides who enters each sub-room.
 */
export function effectiveRoomRole(
  graph: RoomGraph,
  roomId: string,
  memo: RoomRoleMemo = new Map()
): RoomRole | undefined {
  if (memo.has(roomId)) return memo.get(roomId)
  const room = graph.rooms.get(roomId)
  if (!room) return undefined
  // Marked before recursing, so a cycle in damaged data ends instead of looping.
  memo.set(roomId, undefined)
  let role = graph.direct.get(roomId)
  if (room.parentId) {
    const parent = effectiveRoomRole(graph, room.parentId, memo)
    if (parent === 'owner') role = 'owner'
    else if (room.accessMode === 'inherit') role = higher(role, parent)
  }
  memo.set(roomId, role)
  return role
}

/** Whether a room or any room above it is archived. */
export function roomIsArchived(graph: RoomGraph, roomId: string): boolean {
  const seen = new Set<string>()
  let current = graph.rooms.get(roomId)
  while (current && !seen.has(current.id)) {
    if (current.archivedAt !== null) return true
    seen.add(current.id)
    current = current.parentId ? graph.rooms.get(current.parentId) : undefined
  }
  return false
}

/** A room and every room under it, at any depth. */
export function roomSubtree(graph: RoomGraph, roomId: string): string[] {
  const result: string[] = []
  const pending = [roomId]
  const seen = new Set<string>()
  while (pending.length > 0) {
    const id = pending.pop()
    if (id === undefined || seen.has(id)) continue
    seen.add(id)
    result.push(id)
    pending.push(...(graph.children.get(id) ?? []))
  }
  return result
}

/** The rooms above one, nearest first. */
export function roomAncestors(graph: RoomGraph, roomId: string): RoomNode[] {
  const result: RoomNode[] = []
  const seen = new Set<string>([roomId])
  let parentId = graph.rooms.get(roomId)?.parentId ?? null
  while (parentId && !seen.has(parentId)) {
    const parent = graph.rooms.get(parentId)
    if (!parent) break
    result.push(parent)
    seen.add(parentId)
    parentId = parent.parentId
  }
  return result
}

/** The rooms of the given workspaces and one person's own memberships in them. */
export async function loadRoomGraph(
  database: RoomDatabase,
  userId: string,
  workspaceIds: string[]
): Promise<RoomGraph> {
  if (workspaceIds.length === 0) return buildRoomGraph([], new Map())
  const rooms = await database
    .selectFrom('room')
    .select(['id', 'workspaceId', 'parentId', 'name', 'accessMode', 'archivedAt'])
    .where('workspaceId', 'in', workspaceIds)
    .execute()
  const memberships = await database
    .selectFrom('roomMember')
    .innerJoin('room', 'room.id', 'roomMember.roomId')
    .select(['roomMember.roomId', 'roomMember.role'])
    .where('roomMember.userId', '=', userId)
    .where('room.workspaceId', 'in', workspaceIds)
    .execute()
  return buildRoomGraph(
    rooms,
    new Map(memberships.map((membership) => [membership.roomId, membership.role]))
  )
}

/** The workspaces in which someone is on any room's list. */
export async function workspacesWithRooms(
  database: RoomDatabase,
  userId: string
): Promise<string[]> {
  const rows = await database
    .selectFrom('roomMember')
    .innerJoin('room', 'room.id', 'roomMember.roomId')
    .select('room.workspaceId')
    .distinct()
    .where('roomMember.userId', '=', userId)
    .execute()
  return rows.map((row) => row.workspaceId)
}

/** The room a document is kept in, and the person's role there, or null when it is in none. */
export async function documentRoomAccess(
  database: RoomDatabase,
  userId: string,
  documentId: string
): Promise<{ roomId: string; role: RoomRole | undefined } | null> {
  const file = await database
    .selectFrom('roomFile')
    .innerJoin('room', 'room.id', 'roomFile.roomId')
    .select(['roomFile.roomId', 'room.workspaceId'])
    .where('roomFile.documentId', '=', documentId)
    .executeTakeFirst()
  if (!file) return null
  const graph = await loadRoomGraph(database, userId, [file.workspaceId])
  return { roomId: file.roomId, role: effectiveRoomRole(graph, file.roomId) }
}
