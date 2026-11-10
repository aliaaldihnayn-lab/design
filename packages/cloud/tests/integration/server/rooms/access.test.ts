import { describe, expect, test } from 'bun:test'

import { createCloudTestDatabase, type CloudTestDatabase } from '#cloud-tests/helpers/database'
import type { RoomRole } from '#cloud/contract'
import { canDeleteDocument, resolveDocumentAccess } from '#cloud/server/documents/access'
import { listDocuments } from '#cloud/server/documents/repository'
import { documentRoomAccess } from '#cloud/server/rooms/access'

async function expectRejected(promise: Promise<unknown>): Promise<void> {
  expect(
    await promise.then(
      () => 'accepted',
      () => 'rejected'
    )
  ).toBe('rejected')
}

const alice = crypto.randomUUID()
const bob = crypto.randomUUID()
const carol = crypto.randomUUID()

/** A workspace where Alice and Bob are members, and Carol is not. */
async function seed(runtime: CloudTestDatabase) {
  const { database } = runtime
  const workspaceId = crypto.randomUUID()
  await database
    .insertInto('workspace')
    .values({ id: workspaceId, name: 'Studio', slug: `studio-${workspaceId}`, createdBy: alice })
    .execute()
  await database
    .insertInto('workspaceMember')
    .values([
      { workspaceId, userId: alice, role: 'admin' },
      { workspaceId, userId: bob, role: 'editor' }
    ])
    .execute()
  const room = async (
    name: string,
    parentId: string | null,
    accessMode: 'inherit' | 'restricted',
    members: Array<[string, RoomRole]>
  ) => {
    const id = crypto.randomUUID()
    await database
      .insertInto('room')
      .values({ id, workspaceId, parentId, name, accessMode, createdBy: alice })
      .execute()
    if (members.length > 0) {
      await database
        .insertInto('roomMember')
        .values(members.map(([userId, role]) => ({ roomId: id, userId, role, addedBy: alice })))
        .execute()
    }
    return id
  }
  const document = async (name: string, roomId: string | null) => {
    const id = crypto.randomUUID()
    await database
      .insertInto('document')
      .values({ id, workspaceId, name, kind: 'design', createdBy: alice })
      .execute()
    if (roomId) {
      await database
        .insertInto('roomFile')
        .values({ documentId: id, roomId, addedBy: alice })
        .execute()
    }
    return id
  }
  return { workspaceId, room, document }
}

describe('rooms migration', () => {
  test('keeps top-level rooms restricted and every room to one owner', async () => {
    const runtime = await createCloudTestDatabase()
    try {
      const { workspaceId, room } = await seed(runtime)
      const top = await room('Top', null, 'restricted', [[alice, 'owner']])
      await expectRejected(
        runtime.database
          .insertInto('room')
          .values({
            id: crypto.randomUUID(),
            workspaceId,
            parentId: null,
            name: 'Loose',
            accessMode: 'inherit',
            createdBy: alice
          })
          .execute()
      )
      await expectRejected(
        runtime.database
          .insertInto('roomMember')
          .values({ roomId: top, userId: bob, role: 'owner', addedBy: alice })
          .execute()
      )
      await expectRejected(
        runtime.database
          .insertInto('roomMember')
          .values({ roomId: top, userId: bob, role: 'guest' as RoomRole, addedBy: alice })
          .execute()
      )
      // Deleting a room takes its sub-rooms with it.
      const child = await room('Child', top, 'inherit', [])
      await runtime.database.deleteFrom('room').where('id', '=', top).execute()
      expect(
        await runtime.database.selectFrom('room').select('id').where('id', '=', child).execute()
      ).toEqual([])
    } finally {
      await runtime.close()
    }
  })
})

describe('documents kept in rooms', () => {
  test('a restricted sub-room decides who opens its files, not the workspace', async () => {
    const runtime = await createCloudTestDatabase()
    try {
      const { workspaceId, room, document } = await seed(runtime)
      const top = await room('Top', null, 'restricted', [
        [alice, 'owner'],
        [bob, 'viewer']
      ])
      const open = await room('Open', top, 'inherit', [])
      const secret = await room('Secret', top, 'restricted', [[carol, 'editor']])
      const loose = await document('Loose', null)
      const inOpen = await document('In open', open)
      const inSecret = await document('In secret', secret)
      const { database } = runtime

      // Bob views the inherited room's file through the room, not edits it through the workspace.
      expect(await resolveDocumentAccess(database, bob, inOpen)).toEqual({
        permission: 'view',
        canManageSharing: false,
        sources: ['room']
      })
      expect(await documentRoomAccess(database, bob, inOpen)).toEqual({
        roomId: open,
        role: 'viewer'
      })
      // Bob is a workspace editor but not on the restricted room's list: he cannot open its file.
      expect(await resolveDocumentAccess(database, bob, inSecret)).toBeUndefined()
      expect(await canDeleteDocument(database, bob, inSecret)).toBe(false)
      // Carol is in no workspace, yet the restricted room lets her edit its file.
      expect(await resolveDocumentAccess(database, carol, inSecret)).toEqual({
        permission: 'edit',
        canManageSharing: true,
        sources: ['room']
      })
      expect(await canDeleteDocument(database, carol, inSecret)).toBe(true)
      expect(await resolveDocumentAccess(database, carol, inOpen)).toBeUndefined()
      // A document in no room is still the workspace's.
      expect((await resolveDocumentAccess(database, bob, loose))?.sources).toEqual(['workspace'])

      // The workspace list leaves out files of rooms the person cannot enter.
      const bobsList = await listDocuments(database, bob, workspaceId)
      expect(bobsList?.map((entry) => entry.name).sort()).toEqual(['In open', 'Loose'])
      const alicesList = await listDocuments(database, alice, workspaceId)
      expect(alicesList?.map((entry) => entry.name).sort()).toEqual([
        'In open',
        'In secret',
        'Loose'
      ])
    } finally {
      await runtime.close()
    }
  })
})
