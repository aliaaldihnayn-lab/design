import { groupBy } from 'es-toolkit'

import type { RoomSummary } from '@lawha/cloud/contract'

/** A room with the sub-rooms the person may enter, as the tree draws it. */
export type RoomTreeNode = { room: RoomSummary; children: RoomTreeNode[] }

/**
 * Nests the flat list the server sends. A room whose parent the person cannot enter comes back
 * with no parent, so it stands at the top of their tree.
 */
export function buildRoomTree(rooms: readonly RoomSummary[], locale?: string): RoomTreeNode[] {
  const known = new Set(rooms.map((room) => room.id))
  const byParent = groupBy(rooms, (room) =>
    room.parentId && known.has(room.parentId) ? room.parentId : ''
  )
  const collator = new Intl.Collator(locale, { sensitivity: 'base', numeric: true })
  const seen = new Set<string>()
  const nodes = (parentId: string): RoomTreeNode[] =>
    (byParent[parentId] ?? [])
      .filter((room) => !seen.has(room.id))
      .toSorted((a, b) => collator.compare(a.name, b.name))
      .map((room) => {
        seen.add(room.id)
        return { room, children: nodes(room.id) }
      })
  return nodes('')
}

/** A room and every room under it, so a room is never moved inside itself. */
export function roomDescendants(rooms: readonly RoomSummary[], roomId: string): Set<string> {
  const byParent = groupBy(rooms, (room) => room.parentId ?? '')
  const found = new Set<string>([roomId])
  const pending = [roomId]
  while (pending.length > 0) {
    const id = pending.pop() ?? ''
    for (const child of byParent[id] ?? []) {
      if (found.has(child.id)) continue
      found.add(child.id)
      pending.push(child.id)
    }
  }
  return found
}

/** The rooms as the move menu lists them, indented by depth. */
export function flattenRoomTree(
  nodes: readonly RoomTreeNode[],
  depth = 0
): Array<{ room: RoomSummary; depth: number }> {
  return nodes.flatMap((node) => [
    { room: node.room, depth },
    ...flattenRoomTree(node.children, depth + 1)
  ])
}
