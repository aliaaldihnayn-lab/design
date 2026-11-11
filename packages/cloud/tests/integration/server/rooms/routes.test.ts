import { describe, expect, test } from 'bun:test'

import { responseJSON } from '#cloud-tests/helpers/response'
import { people, roomTestApp as testApp, documentResponseSchema } from '#cloud-tests/helpers/rooms'
import {
  roomAuditSchema,
  roomDetailSchema,
  roomMembersSchema,
  RELAY_ROOM_PARAM,
  roomPresenceSchema,
  roomPresenceTicketSchema,
  roomTreeSchema
} from '#cloud/contract'
import { authorizeRoomPresenceTicket, createRoomPresenceStore } from '#cloud/server/rooms/presence'
import * as v from 'valibot'

describe('rooms', () => {
  test('builds a tree of rooms and sub-rooms, inherited or restricted, and hides what someone cannot enter', async () => {
    const { runtime, as, sent, createRoom, invite, accept, treeOf } = await testApp()
    try {
      const top = await createRoom(people.alice, { name: 'Clients' })
      expect(top).toMatchObject({ role: 'owner', accessMode: 'restricted', parentId: null })
      const shared = await createRoom(people.alice, { name: 'Shared', parentId: top.id })
      expect(shared.accessMode).toBe('inherit')
      const deep = await createRoom(people.alice, { name: 'Deep', parentId: shared.id })
      const secret = await createRoom(people.alice, {
        name: 'Secret',
        parentId: top.id,
        accessMode: 'restricted'
      })
      // A top-level room has no parent to inherit from.
      const inheritTop = await as(people.alice)('/api/rooms', {
        method: 'POST',
        json: { name: 'Loose', workspaceId: top.workspaceId, accessMode: 'inherit' }
      })
      expect(inheritTop.status).toBe(422)
      // Only workspace writers make top-level rooms; Carol is not even a member.
      const outsider = await as(people.carol)('/api/rooms', {
        method: 'POST',
        json: { name: 'Mine', workspaceId: top.workspaceId }
      })
      expect(outsider.status).toBe(404)

      // Bob joins the top room as a viewer through the emailed invitation link.
      const invited = await invite(people.alice, top.id, {
        email: 'Bob@Example.com',
        role: 'viewer'
      })
      expect(sent.map((message) => message.payload.roomName)).toEqual(['Clients'])
      expect(sent[0]?.payload.acceptanceURL).toBe(invited.acceptanceURL)
      const link = new URL(invited.acceptanceURL)
      const preview = await as(people.bob)(
        `/api/public/invitations/${invited.invitation.id}/preview`,
        { method: 'POST', json: { token: link.hash.slice(1) } }
      )
      expect(await preview.json()).toMatchObject({
        invitation: { kind: 'room', roomName: 'Clients', role: 'viewer', inviterName: 'Alice' }
      })
      // The link is Bob's: Carol cannot use it to get in.
      expect((await accept(people.carol, invited.acceptanceURL)).status).toBe(404)
      const accepted = await accept(people.bob, invited.acceptanceURL)
      expect(await accepted.json()).toEqual({
        accepted: { kind: 'room', roomId: top.id, role: 'viewer' }
      })
      expect((await accept(people.bob, invited.acceptanceURL)).status).toBe(404)

      // Bob sees the top room and what inherits from it, not the restricted sub-room.
      const bobsTree = await treeOf(people.bob)
      expect(bobsTree.map((room) => room.name).sort()).toEqual(['Clients', 'Deep', 'Shared'])
      expect(bobsTree.find((room) => room.id === deep.id)).toMatchObject({
        role: 'viewer',
        parentId: shared.id
      })
      const detail = await responseJSON(
        await as(people.bob)(`/api/rooms/${top.id}`),
        roomDetailSchema
      )
      expect(detail.children.map((room) => room.name)).toEqual(['Shared'])
      expect((await treeOf(people.alice)).map((room) => room.name).sort()).toEqual([
        'Clients',
        'Deep',
        'Secret',
        'Shared'
      ])

      // A non-member cannot list, open, check in to, or manage the restricted sub-room.
      for (const path of [
        `/api/rooms/${secret.id}`,
        `/api/rooms/${secret.id}/members`,
        `/api/rooms/${secret.id}/presence`
      ]) {
        expect((await as(people.bob)(path)).status).toBe(404)
      }
      expect(
        (await as(people.bob)(`/api/rooms/${secret.id}/presence`, { method: 'POST' })).status
      ).toBe(404)
      expect(
        (
          await as(people.bob)(`/api/rooms/${secret.id}/invitations`, {
            method: 'POST',
            json: { email: 'bob@example.com', role: 'editor' }
          })
        ).status
      ).toBe(404)
      expect(
        (
          await as(people.bob)(`/api/rooms/${secret.id}/members/${people.bob.userId}`, {
            method: 'PATCH',
            json: { role: 'editor' }
          })
        ).status
      ).toBe(404)
      // Viewers cannot invite to the room they are in either.
      expect(
        (
          await as(people.bob)(`/api/rooms/${top.id}/invitations`, {
            method: 'POST',
            json: { email: 'dave@example.com', role: 'editor' }
          })
        ).status
      ).toBe(403)
      // Carol, invited only to the restricted sub-room, sees it at the top of her tree.
      const toSecret = await invite(people.alice, secret.id, {
        email: 'carol@example.com',
        role: 'editor'
      })
      // Bob cannot join the restricted room with Carol's link.
      expect((await accept(people.bob, toSecret.acceptanceURL)).status).toBe(404)
      expect((await accept(people.carol, toSecret.acceptanceURL)).status).toBe(200)
      const carolsTree = await treeOf(people.carol)
      expect(carolsTree.map((room) => [room.name, room.parentId, room.role])).toEqual([
        ['Secret', null, 'editor']
      ])
      const carolsView = await responseJSON(
        await as(people.carol)(`/api/rooms/${secret.id}`),
        roomDetailSchema
      )
      expect(carolsView.path).toEqual([])
      expect((await as(people.carol)(`/api/rooms/${top.id}`)).status).toBe(404)

      // Making the sub-room inherit lets Bob in; making it restricted again shuts him out.
      expect(
        (
          await as(people.alice)(`/api/rooms/${secret.id}`, {
            method: 'PATCH',
            json: { accessMode: 'inherit' }
          })
        ).status
      ).toBe(200)
      expect((await as(people.bob)(`/api/rooms/${secret.id}`)).status).toBe(200)
      // Only the owner chooses; Carol edits the room but does not own it.
      expect(
        (
          await as(people.carol)(`/api/rooms/${secret.id}`, {
            method: 'PATCH',
            json: { accessMode: 'restricted' }
          })
        ).status
      ).toBe(403)
      await as(people.alice)(`/api/rooms/${secret.id}`, {
        method: 'PATCH',
        json: { accessMode: 'restricted' }
      })
      expect((await as(people.bob)(`/api/rooms/${secret.id}`)).status).toBe(404)

      const members = await responseJSON(
        await as(people.alice)(`/api/rooms/${deep.id}/members`),
        roomMembersSchema
      )
      expect(members.members.map((member) => [member.name, member.role, member.source])).toEqual([
        ['Alice', 'owner', 'direct'],
        ['Bob', 'viewer', 'inherited']
      ])
      const audit = await responseJSON(
        await as(people.alice)(`/api/rooms/${secret.id}/audit`),
        roomAuditSchema
      )
      const actions: string[] = audit.events.map((event) => event.action)
      expect(actions.sort()).toEqual(
        [
          'access-changed',
          'access-changed',
          'invitation-accepted',
          'member-invited',
          'room-created'
        ].sort()
      )
      expect((await as(people.carol)(`/api/rooms/${secret.id}/audit`)).status).toBe(403)
    } finally {
      await runtime.close()
    }
  })

  test('keeps files in rooms, opens them through the room, and moves them between rooms', async () => {
    const { runtime, as, workspaceId, createRoom, invite, accept } = await testApp()
    try {
      const top = await createRoom(people.alice, { name: 'Clients' })
      const secret = await createRoom(people.alice, {
        name: 'Secret',
        parentId: top.id,
        accessMode: 'restricted'
      })
      const created = await responseJSON(
        await as(people.alice)(`/api/rooms/${secret.id}/documents`, {
          method: 'POST',
          json: { name: 'Contract', kind: 'design' }
        }),
        documentResponseSchema
      )
      expect(created.document.workspaceId).toBe(workspaceId)
      const documentId = created.document.id

      // Bob is a workspace editor but not in the restricted room: he cannot open or list the file;
      // opening a document starts with the access check that `/access` answers.
      expect((await as(people.bob)(`/api/documents/${documentId}/access`)).status).toBe(404)
      const bobsDocuments = await responseJSON(
        await as(people.bob)(`/api/workspaces/${workspaceId}/documents`),
        v.object({ documents: v.array(v.object({ id: v.string() })) })
      )
      expect(bobsDocuments.documents.map((document) => document.id)).not.toContain(documentId)
      // Nor can he put it in a room he edits.
      const bobsRoom = await createRoom(people.bob, { name: 'Bob’s' })
      expect(
        (
          await as(people.bob)(`/api/rooms/${bobsRoom.id}/files`, {
            method: 'POST',
            json: { documentId }
          })
        ).status
      ).toBe(404)

      // Dave, in no workspace, opens it read-only once invited to the room as a viewer.
      const toDave = await invite(people.alice, secret.id, {
        email: 'dave@example.com',
        role: 'viewer'
      })
      await accept(people.dave, toDave.acceptanceURL)
      const access = await responseJSON(
        await as(people.dave)(`/api/documents/${documentId}/access`),
        v.object({ access: v.object({ permission: v.string(), sources: v.array(v.string()) }) })
      )
      expect(access.access).toEqual({ permission: 'view', sources: ['room'] })
      // A viewer cannot add files or make documents in the room.
      expect(
        (
          await as(people.dave)(`/api/rooms/${secret.id}/documents`, {
            method: 'POST',
            json: { name: 'Mine' }
          })
        ).status
      ).toBe(403)

      // Moving the file to the top room takes it away from Dave and gives nothing to Bob.
      const epochBefore = await runtime.database
        .selectFrom('document')
        .select('collaborationEpoch')
        .where('id', '=', documentId)
        .executeTakeFirstOrThrow()
      const moved = await as(people.alice)(`/api/rooms/${top.id}/files`, {
        method: 'POST',
        json: { documentId }
      })
      expect(moved.status).toBe(201)
      const epochAfter = await runtime.database
        .selectFrom('document')
        .select('collaborationEpoch')
        .where('id', '=', documentId)
        .executeTakeFirstOrThrow()
      expect(epochAfter.collaborationEpoch).toBeGreaterThan(epochBefore.collaborationEpoch)
      expect((await as(people.dave)(`/api/documents/${documentId}/access`)).status).toBe(404)
      const topView = await responseJSON(
        await as(people.alice)(`/api/rooms/${top.id}`),
        roomDetailSchema
      )
      expect(topView.files.map((file) => file.document.name)).toEqual(['Contract'])
      expect(topView.room.fileCount).toBe(1)

      // Taking it out of the room gives it back to the workspace.
      expect(
        (await as(people.alice)(`/api/rooms/${top.id}/files/${documentId}`, { method: 'DELETE' }))
          .status
      ).toBe(204)
      expect((await as(people.bob)(`/api/documents/${documentId}/access`)).status).toBe(200)
    } finally {
      await runtime.close()
    }
  })

  test('changes roles, removes and lets people leave, transfers ownership, moves and archives', async () => {
    const { runtime, as, createRoom, invite, accept, treeOf } = await testApp()
    try {
      const top = await createRoom(people.alice, { name: 'Clients' })
      const child = await createRoom(people.alice, { name: 'Child', parentId: top.id })
      const other = await createRoom(people.alice, { name: 'Other' })
      for (const person of [people.bob, people.carol]) {
        const invited = await invite(people.alice, top.id, { email: person.email, role: 'viewer' })
        expect((await accept(person, invited.acceptanceURL)).status).toBe(200)
      }
      // Inviting someone already on the list is refused.
      const again = await as(people.alice)(`/api/rooms/${top.id}/invitations`, {
        method: 'POST',
        json: { email: 'bob@example.com', role: 'editor' }
      })
      expect(again.status).toBe(409)

      // A newer invitation replaces an older one, and the owner can withdraw it.
      const first = await invite(people.alice, top.id, {
        email: 'dave@example.com',
        role: 'viewer'
      })
      const second = await invite(people.alice, top.id, {
        email: 'dave@example.com',
        role: 'editor'
      })
      expect((await accept(people.dave, first.acceptanceURL)).status).toBe(404)
      const pending = await responseJSON(
        await as(people.alice)(`/api/rooms/${top.id}/members`),
        roomMembersSchema
      )
      expect(
        pending.invitations.map((invitation) => [invitation.email, invitation.status])
      ).toEqual([['dave@example.com', 'pending']])
      expect(
        (
          await as(people.alice)(`/api/rooms/${top.id}/invitations/${second.invitation.id}`, {
            method: 'DELETE'
          })
        ).status
      ).toBe(204)
      expect((await accept(people.dave, second.acceptanceURL)).status).toBe(404)
      // An expired invitation no longer works.
      const late = await invite(people.alice, top.id, { email: 'dave@example.com', role: 'viewer' })
      await runtime.database
        .updateTable('roomInvitation')
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where('id', '=', late.invitation.id)
        .execute()
      expect((await accept(people.dave, late.acceptanceURL)).status).toBe(404)

      expect(
        (
          await as(people.alice)(`/api/rooms/${top.id}/members/${people.bob.userId}`, {
            method: 'PATCH',
            json: { role: 'editor' }
          })
        ).status
      ).toBe(204)
      expect((await treeOf(people.bob)).find((room) => room.id === child.id)?.role).toBe('editor')
      // The owner's role changes only by transfer.
      expect(
        (
          await as(people.alice)(`/api/rooms/${top.id}/members/${people.alice.userId}`, {
            method: 'PATCH',
            json: { role: 'viewer' }
          })
        ).status
      ).toBe(422)

      // Carol leaves; the owner removes no one by leaving.
      expect(
        (await as(people.carol)(`/api/rooms/${top.id}/leave`, { method: 'POST' })).status
      ).toBe(204)
      expect(await treeOf(people.carol)).toEqual([])
      expect(
        (await as(people.alice)(`/api/rooms/${top.id}/leave`, { method: 'POST' })).status
      ).toBe(422)

      // Someone who is not in the room cannot be given it.
      expect(
        (
          await as(people.alice)(`/api/rooms/${top.id}/transfer`, {
            method: 'POST',
            json: { userId: people.dave.userId }
          })
        ).status
      ).toBe(422)
      expect(
        (
          await as(people.alice)(`/api/rooms/${top.id}/transfer`, {
            method: 'POST',
            json: { userId: people.bob.userId }
          })
        ).status
      ).toBe(204)
      const afterTransfer = await treeOf(people.alice)
      expect(afterTransfer.find((room) => room.id === top.id)).toMatchObject({
        role: 'editor',
        ownerId: people.bob.userId
      })
      // Bob now owns the room, so he removes Alice's say in it.
      expect(
        (
          await as(people.bob)(`/api/rooms/${top.id}/members/${people.alice.userId}`, {
            method: 'PATCH',
            json: { role: 'viewer' }
          })
        ).status
      ).toBe(204)
      // Alice still owns the child she made, but no longer runs the room above it.
      expect(
        (
          await as(people.alice)(`/api/rooms/${child.id}/move`, {
            method: 'POST',
            json: { parentId: other.id }
          })
        ).status
      ).toBe(200)
      const aliceTree = await treeOf(people.alice)
      expect(aliceTree.find((room) => room.id === child.id)?.parentId).toBe(other.id)
      // Bob's role in the child came from the top room it no longer sits in.
      expect((await treeOf(people.bob)).map((room) => room.id)).not.toContain(child.id)
      // A room cannot go inside itself.
      expect(
        (
          await as(people.alice)(`/api/rooms/${other.id}/move`, {
            method: 'POST',
            json: { parentId: child.id }
          })
        ).status
      ).toBe(422)

      expect(
        (
          await as(people.alice)(`/api/rooms/${other.id}`, {
            method: 'PATCH',
            json: { archived: true }
          })
        ).status
      ).toBe(200)
      const visible = (await treeOf(people.alice)).map((room) => room.id)
      expect(visible).not.toContain(other.id)
      expect(visible).not.toContain(child.id)
      const archived = await responseJSON(
        await as(people.alice)('/api/rooms?archived=true'),
        roomTreeSchema
      )
      expect(archived.rooms.map((room) => room.id)).toContain(other.id)

      const audit = await responseJSON(
        await as(people.bob)(`/api/rooms/${top.id}/audit`),
        roomAuditSchema
      )
      expect(audit.events.map((event) => event.action)).toEqual(
        expect.arrayContaining([
          'member-left',
          'ownership-transferred',
          'role-changed',
          'invitation-revoked'
        ])
      )
      const transfer = audit.events.find((event) => event.action === 'ownership-transferred')
      expect(transfer).toMatchObject({
        actor: { id: people.alice.userId, name: 'Alice' },
        subjectUserId: people.bob.userId,
        metadata: { from: people.alice.userId }
      })
    } finally {
      await runtime.close()
    }
  })

  test('shows who is in a room now from check-ins', async () => {
    const { runtime, as, createRoom, invite, accept } = await testApp()
    try {
      const top = await createRoom(people.alice, { name: 'Clients' })
      const invited = await invite(people.alice, top.id, {
        email: 'bob@example.com',
        role: 'viewer'
      })
      await accept(people.bob, invited.acceptanceURL)
      await as(people.alice)(`/api/rooms/${top.id}/presence`, { method: 'POST' })
      const both = await responseJSON(
        await as(people.bob)(`/api/rooms/${top.id}/presence`, { method: 'POST' }),
        roomPresenceSchema
      )
      expect(both.people.map((person) => person.name)).toEqual(['Alice', 'Bob'])
      // A check-in older than the window no longer counts.
      await runtime.database
        .updateTable('roomPresence')
        .set({ seenAt: new Date(Date.now() - 60_000) })
        .where('userId', '=', people.alice.userId)
        .execute()
      await as(people.bob)(`/api/rooms/${top.id}/presence`, { method: 'DELETE' })
      const none = await responseJSON(
        await as(people.alice)(`/api/rooms/${top.id}/presence`),
        roomPresenceSchema
      )
      expect(none.people).toEqual([])
      expect((await as(people.carol)(`/api/rooms/${top.id}/presence`)).status).toBe(404)
    } finally {
      await runtime.close()
    }
  })

  test('issues live presence tickets to room members and stops recording people who left it', async () => {
    const { runtime, as, createRoom, invite, accept } = await testApp()
    try {
      const top = await createRoom(people.alice, { name: 'Clients' })
      const invited = await invite(people.alice, top.id, {
        email: 'bob@example.com',
        role: 'viewer'
      })
      await accept(people.bob, invited.acceptanceURL)
      const issued = await responseJSON(
        await as(people.bob)(`/api/rooms/${top.id}/presence/ticket`, { method: 'POST' }),
        roomPresenceTicketSchema
      )
      expect(new URL(issued.serverURL).searchParams.get(RELAY_ROOM_PARAM)).toBe(top.id)
      const authorization = await authorizeRoomPresenceTicket(
        issued.token,
        'integration-test-secret-at-least-32-characters'
      )
      expect(authorization).toMatchObject({ roomId: top.id, userId: people.bob.userId })
      expect(
        (await as(people.carol)(`/api/rooms/${top.id}/presence/ticket`, { method: 'POST' })).status
      ).toBe(404)

      const store = createRoomPresenceStore(runtime.database)
      expect(await store.seen(top.id, people.bob.userId)).toBe(true)
      expect(await store.seen(top.id, people.carol.userId)).toBe(false)
      expect((await store.list(top.id)).people.map((person) => person.name)).toEqual(['Bob'])
      await store.left(top.id, people.bob.userId)
      expect((await store.list(top.id)).people).toEqual([])
    } finally {
      await runtime.close()
    }
  })
})
