import { describe, expect, test } from 'bun:test'

import type { RoomRole } from '#cloud/contract'
import {
  buildRoomGraph,
  effectiveRoomRole,
  roomAncestors,
  roomIsArchived,
  roomSubtree,
  type RoomNode
} from '#cloud/server/rooms/access'

const workspaceId = crypto.randomUUID()

function room(
  id: string,
  parentId: string | null,
  accessMode: RoomNode['accessMode'] = 'inherit'
): RoomNode {
  return {
    id,
    workspaceId,
    parentId,
    name: id,
    accessMode: parentId ? accessMode : 'restricted',
    archivedAt: null
  }
}

// studio → (design inherits, private keeps to itself) → design/drafts inherits, private/legal inherits
const rooms = [
  room('studio', null),
  room('design', 'studio'),
  room('drafts', 'design'),
  room('private', 'studio', 'restricted'),
  room('legal', 'private')
]

function roleIn(direct: Record<string, RoomRole>, roomId: string) {
  return effectiveRoomRole(buildRoomGraph(rooms, new Map(Object.entries(direct))), roomId)
}

describe('room roles', () => {
  test('a sub-room set to inherit lets in its parent’s members with their role, at any depth', () => {
    expect(roleIn({ studio: 'viewer' }, 'drafts')).toBe('viewer')
    expect(roleIn({ studio: 'editor' }, 'design')).toBe('editor')
  })

  test('a restricted sub-room keeps out the parent’s members, and so does what inherits from it', () => {
    expect(roleIn({ studio: 'editor' }, 'private')).toBeUndefined()
    expect(roleIn({ studio: 'editor' }, 'legal')).toBeUndefined()
    expect(roleIn({ private: 'viewer' }, 'legal')).toBe('viewer')
  })

  test('someone on a sub-room’s own list enters it without the parent', () => {
    expect(roleIn({ drafts: 'editor' }, 'drafts')).toBe('editor')
    expect(roleIn({ drafts: 'editor' }, 'design')).toBeUndefined()
    expect(roleIn({ drafts: 'editor' }, 'studio')).toBeUndefined()
  })

  test('the higher of an own and an inherited role counts', () => {
    expect(roleIn({ studio: 'editor', design: 'viewer' }, 'design')).toBe('editor')
    expect(roleIn({ studio: 'viewer', design: 'editor' }, 'drafts')).toBe('editor')
  })

  test('the owner of a room runs every room under it, restricted ones too', () => {
    expect(roleIn({ studio: 'owner' }, 'private')).toBe('owner')
    expect(roleIn({ studio: 'owner' }, 'legal')).toBe('owner')
  })

  test('a cycle in damaged data ends instead of looping', () => {
    const looped = buildRoomGraph(
      [room('a', 'b'), { ...room('b', 'a'), accessMode: 'inherit' }],
      new Map([['a', 'viewer']])
    )
    expect(effectiveRoomRole(looped, 'b')).toBe('viewer')
    expect(roomAncestors(looped, 'a').map((entry) => entry.id)).toEqual(['b'])
  })

  test('subtrees, ancestors and archiving follow the tree', () => {
    const graph = buildRoomGraph(
      rooms.map((entry) => (entry.id === 'design' ? { ...entry, archivedAt: new Date() } : entry)),
      new Map()
    )
    expect(roomSubtree(graph, 'studio').sort()).toEqual(
      ['design', 'drafts', 'legal', 'private', 'studio'].sort()
    )
    expect(roomAncestors(graph, 'drafts').map((entry) => entry.id)).toEqual(['design', 'studio'])
    expect(roomIsArchived(graph, 'drafts')).toBe(true)
    expect(roomIsArchived(graph, 'legal')).toBe(false)
  })
})
