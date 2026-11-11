import type { RoomRole } from '#cloud/contract'

import {
  effectiveRoomRole,
  loadRoomGraph,
  roomRoleAtLeast,
  type RoomDatabase,
  type RoomGraph,
  type RoomNode
} from './access'
import { RoomForbiddenError, RoomNotFoundError } from './errors'

export type RoomEntry = { room: RoomNode; role: RoomRole; graph: RoomGraph }

/**
 * The room with the person's role in it, when they may enter it and have at least `minimum`;
 * someone kept out gets `RoomNotFoundError`, as if the room did not exist.
 */
export async function requireRoom(
  database: RoomDatabase,
  userId: string,
  roomId: string,
  minimum: RoomRole = 'viewer'
): Promise<RoomEntry> {
  const row = await database
    .selectFrom('room')
    .select('workspaceId')
    .where('id', '=', roomId)
    .executeTakeFirst()
  if (!row) throw new RoomNotFoundError()
  const graph = await loadRoomGraph(database, userId, [row.workspaceId])
  const room = graph.rooms.get(roomId)
  const role = effectiveRoomRole(graph, roomId)
  if (!room || !role) throw new RoomNotFoundError()
  if (!roomRoleAtLeast(role, minimum)) throw new RoomForbiddenError()
  return { room, role, graph }
}
