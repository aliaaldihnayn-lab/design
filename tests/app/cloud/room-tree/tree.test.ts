import { describe, expect, test } from 'bun:test'

import type { RoomSummary } from '@lawha/cloud/contract'

import { buildRoomTree, flattenRoomTree, roomDescendants } from '@/app/cloud/room-tree/tree'

const workspaceId = crypto.randomUUID()

function room(name: string, parentId: string | null = null): RoomSummary {
  return {
    id: crypto.randomUUID(),
    workspaceId,
    parentId,
    name,
    accessMode: parentId ? 'inherit' : 'restricted',
    role: 'owner',
    ownerId: 'alice',
    fileCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    archivedAt: null
  }
}

describe('the room tree', () => {
  test('nests rooms under their parents, sorted by name, at any depth', () => {
    const clients = room('Clients')
    const beta = room('Beta', clients.id)
    const alpha = room('alpha', clients.id)
    const drafts = room('Drafts', alpha.id)
    const tree = buildRoomTree([drafts, beta, clients, alpha], 'en')
    expect(tree.map((node) => node.room.name)).toEqual(['Clients'])
    expect(tree[0]?.children.map((node) => node.room.name)).toEqual(['alpha', 'Beta'])
    expect(tree[0]?.children[0]?.children.map((node) => node.room.name)).toEqual(['Drafts'])
    expect(flattenRoomTree(tree).map(({ room: entry, depth }) => [entry.name, depth])).toEqual([
      ['Clients', 0],
      ['alpha', 1],
      ['Drafts', 2],
      ['Beta', 1]
    ])
  })

  test('puts a room whose parent is not listed at the top', () => {
    const hidden = room('Hidden')
    const invited = room('Invited', hidden.id)
    expect(buildRoomTree([invited]).map((node) => node.room.name)).toEqual(['Invited'])
  })

  test('lists a room and everything under it, so it never moves inside itself', () => {
    const top = room('Top')
    const child = room('Child', top.id)
    const grandchild = room('Grandchild', child.id)
    const other = room('Other')
    expect(roomDescendants([top, child, grandchild, other], top.id)).toEqual(
      new Set([top.id, child.id, grandchild.id])
    )
  })
})
