import type {
  CreateRoomInvitationInput,
  CreatedRoomInvitation,
  InvitationPreview,
  RoomInvitation,
  RoomMember,
  RoomMemberRole,
  RoomMembers,
  RoomRole
} from '#cloud/contract'
import { cloudInvitationURL } from '#cloud/contract'
import type { CloudActor } from '#cloud/server/auth'
import type { CloudDatabase } from '#cloud/server/db'
import type { TransactionalEmailService } from '#cloud/server/email/types'
import {
  invitationMatchesActor,
  invitationTokenIsActive,
  recipientHint
} from '#cloud/server/sharing/continuation'
import { dateString } from '#cloud/server/sharing/contracts'
import { hashCapability } from '#cloud/server/sharing/crypto'
import { groupBy } from 'es-toolkit'
import type { Kysely } from 'kysely'

import { randomHex } from '@lawha/scene-graph/random'

import {
  buildRoomGraph,
  effectiveRoomRole,
  roomAncestors,
  roomSubtree,
  type RoomDatabase,
  type RoomGraph
} from './access'
import { endRoomSessions, recordRoomEvent } from './audit'
import {
  RoomAlreadyMemberError,
  RoomInvalidError,
  RoomInvitationInvalidError,
  RoomNotFoundError
} from './errors'
import { requireRoom } from './guard'

const INVITATION_SECRET_BYTES = 24
const INVITATION_LIFETIME_MS = 7 * 24 * 60 * 60_000

export type RoomMemberServiceOptions = {
  email?: TransactionalEmailService
  publicURL: string
}

type InvitationRow = {
  id: string
  emailNormalized: string
  role: RoomMemberRole
  status: 'pending' | 'accepted' | 'revoked'
  invitedBy: string
  inviterName: string | null
  invitedAt: Date | string
  expiresAt: Date | string
}

function invitationContract(row: InvitationRow, now = Date.now()): RoomInvitation {
  const expired = row.status === 'pending' && new Date(row.expiresAt).getTime() <= now
  return {
    id: row.id,
    email: row.emailNormalized,
    role: row.role,
    status: expired ? 'expired' : row.status,
    invitedBy: { id: row.invitedBy, name: row.inviterName },
    invitedAt: dateString(row.invitedAt) ?? '',
    expiresAt: dateString(row.expiresAt) ?? ''
  }
}

/** Account rows joined on a text user id column. */
async function usersByID(database: RoomDatabase, userIds: string[]) {
  if (userIds.length === 0) return []
  return database
    .selectFrom('user')
    .select(['id', 'name', 'email', 'image'])
    .where((expression) =>
      expression(expression.cast(expression.ref('user.id'), 'text'), 'in', userIds)
    )
    .execute()
}

/**
 * Everyone's role in a room, from the list rows of the room and the rooms above it: the same rule
 * as `effectiveRoomRole`, applied to each person on any of those lists.
 */
async function roomRoles(
  database: RoomDatabase,
  graph: RoomGraph,
  roomId: string
): Promise<Array<{ userId: string; role: RoomRole; direct: boolean; joinedAt: Date | string }>> {
  const chain = [graph.rooms.get(roomId), ...roomAncestors(graph, roomId)].filter(
    (room) => room !== undefined
  )
  const rows = await database
    .selectFrom('roomMember')
    .select(['roomId', 'userId', 'role', 'createdAt'])
    .where(
      'roomId',
      'in',
      chain.map((room) => room.id)
    )
    .execute()
  const byUser = groupBy(rows, (row) => row.userId)
  const result = []
  for (const [userId, memberships] of Object.entries(byUser)) {
    const personal = buildRoomGraph(
      chain,
      new Map(memberships.map((membership) => [membership.roomId, membership.role]))
    )
    const role = effectiveRoomRole(personal, roomId)
    if (!role) continue
    const own = memberships.find((membership) => membership.roomId === roomId)
    result.push({
      userId,
      role,
      direct: own !== undefined,
      joinedAt: own?.createdAt ?? memberships[0]?.createdAt ?? new Date()
    })
  }
  return result
}

/**
 * Who may enter a room. Only its owner invites, changes roles, removes people, and hands the room
 * on; anyone on its list but the owner may leave. Every change goes to the room's audit trail.
 */
export function createRoomMemberService(
  database: Kysely<CloudDatabase>,
  options: RoomMemberServiceOptions
) {
  async function inviterName(userId: string): Promise<string | null> {
    const inviter = await database
      .selectFrom('user')
      .select('name')
      .where('id', '=', userId)
      .executeTakeFirst()
    return inviter?.name ?? null
  }

  async function directRow(roomId: string, userId: string) {
    return database
      .selectFrom('roomMember')
      .select(['role'])
      .where('roomId', '=', roomId)
      .where('userId', '=', userId)
      .executeTakeFirst()
  }

  return {
    async list(userId: string, roomId: string): Promise<RoomMembers> {
      const { role, graph } = await requireRoom(database, userId, roomId)
      const roles = await roomRoles(database, graph, roomId)
      const accounts = await usersByID(
        database,
        roles.map((entry) => entry.userId)
      )
      const accountOf = new Map(accounts.map((account) => [account.id, account]))
      const members: RoomMember[] = roles.flatMap((entry) => {
        const account = accountOf.get(entry.userId)
        if (!account) return []
        return [
          {
            userId: entry.userId,
            name: account.name,
            email: account.email,
            image: account.image,
            role: entry.role,
            source: entry.direct ? 'direct' : 'inherited',
            joinedAt: dateString(entry.joinedAt) ?? ''
          }
        ]
      })
      members.sort((a, b) => a.name.localeCompare(b.name))
      const invitations =
        role === 'owner'
          ? await database
              .selectFrom('roomInvitation')
              .leftJoin('user', (join) =>
                join.on((expression) =>
                  expression(
                    expression.cast(expression.ref('user.id'), 'text'),
                    '=',
                    expression.ref('roomInvitation.invitedBy')
                  )
                )
              )
              .select([
                'roomInvitation.id',
                'roomInvitation.emailNormalized',
                'roomInvitation.role',
                'roomInvitation.status',
                'roomInvitation.invitedBy',
                'roomInvitation.invitedAt',
                'roomInvitation.expiresAt',
                'user.name as inviterName'
              ])
              .where('roomInvitation.roomId', '=', roomId)
              .where('roomInvitation.status', '=', 'pending')
              .orderBy('roomInvitation.invitedAt')
              .execute()
          : []
      return { members, invitations: invitations.map((row) => invitationContract(row)) }
    },

    /** Invites someone by email; a newer invitation to the same address replaces the older. */
    async invite(
      userId: string,
      roomId: string,
      input: CreateRoomInvitationInput
    ): Promise<CreatedRoomInvitation> {
      const { room } = await requireRoom(database, userId, roomId, 'owner')
      const existing = await database
        .selectFrom('roomMember')
        .innerJoin('user', (join) =>
          join.on((expression) =>
            expression(
              expression.cast(expression.ref('user.id'), 'text'),
              '=',
              expression.ref('roomMember.userId')
            )
          )
        )
        .select('roomMember.userId')
        .where('roomMember.roomId', '=', roomId)
        .where((expression) =>
          expression(expression.fn('lower', [expression.ref('user.email')]), '=', input.email)
        )
        .executeTakeFirst()
      if (existing) throw new RoomAlreadyMemberError()
      const name = await inviterName(userId)
      const id = crypto.randomUUID()
      const token = randomHex(INVITATION_SECRET_BYTES)
      const expiresAt = new Date(Date.now() + INVITATION_LIFETIME_MS)
      const acceptanceURL = cloudInvitationURL(options.publicURL, id, token)
      const row = await database.transaction().execute(async (transaction) => {
        await transaction
          .updateTable('roomInvitation')
          .set({ status: 'revoked', revokedAt: new Date() })
          .where('roomId', '=', roomId)
          .where('emailNormalized', '=', input.email)
          .where('status', '=', 'pending')
          .execute()
        const inserted = await transaction
          .insertInto('roomInvitation')
          .values({
            id,
            roomId,
            emailNormalized: input.email,
            role: input.role,
            tokenHash: hashCapability(token),
            invitedBy: userId,
            expiresAt,
            acceptedAt: null,
            acceptedBy: null,
            revokedAt: null
          })
          .returning([
            'id',
            'emailNormalized',
            'role',
            'status',
            'invitedBy',
            'invitedAt',
            'expiresAt'
          ])
          .executeTakeFirstOrThrow()
        await recordRoomEvent(transaction, {
          roomId,
          actorUserId: userId,
          action: 'member-invited',
          subjectEmail: input.email,
          metadata: { role: input.role, invitationId: id }
        })
        await options.email?.enqueue(
          {
            idempotencyKey: `room-invitation/${id}`,
            kind: 'room-invitation',
            recipientEmail: input.email,
            payload: {
              inviterName: name ?? 'A Lawha user',
              roomName: room.name,
              role: input.role,
              expiresAt: expiresAt.toISOString(),
              acceptanceURL
            }
          },
          transaction
        )
        return inserted
      })
      return { invitation: invitationContract({ ...row, inviterName: name }), acceptanceURL }
    },

    async revokeInvitation(userId: string, roomId: string, invitationId: string): Promise<void> {
      await requireRoom(database, userId, roomId, 'owner')
      await database.transaction().execute(async (transaction) => {
        const revoked = await transaction
          .updateTable('roomInvitation')
          .set({ status: 'revoked', revokedAt: new Date() })
          .where('id', '=', invitationId)
          .where('roomId', '=', roomId)
          .where('status', '=', 'pending')
          .returning('emailNormalized')
          .executeTakeFirst()
        if (!revoked) throw new RoomNotFoundError()
        await recordRoomEvent(transaction, {
          roomId,
          actorUserId: userId,
          action: 'invitation-revoked',
          subjectEmail: revoked.emailNormalized,
          metadata: { invitationId }
        })
      })
    },

    /** Changes the role on a person's own list entry; the owner's role changes only by transfer. */
    async updateRole(
      userId: string,
      roomId: string,
      memberId: string,
      role: RoomMemberRole
    ): Promise<void> {
      const { graph } = await requireRoom(database, userId, roomId, 'owner')
      const member = await directRow(roomId, memberId)
      if (!member) throw new RoomInvalidError('not-a-member')
      if (member.role === 'owner') throw new RoomInvalidError('owner-role')
      if (member.role === role) return
      await database.transaction().execute(async (transaction) => {
        await transaction
          .updateTable('roomMember')
          .set({ role })
          .where('roomId', '=', roomId)
          .where('userId', '=', memberId)
          .execute()
        await recordRoomEvent(transaction, {
          roomId,
          actorUserId: userId,
          action: 'role-changed',
          subjectUserId: memberId,
          metadata: { from: member.role, to: role }
        })
        if (role === 'viewer') await endRoomSessions(transaction, roomSubtree(graph, roomId))
      })
    },

    /** Takes someone off a room's list, or lets them leave; the owner hands the room on first. */
    async remove(userId: string, roomId: string, memberId: string): Promise<void> {
      const leaving = memberId === userId
      const { graph } = await requireRoom(database, userId, roomId, leaving ? 'viewer' : 'owner')
      const member = await directRow(roomId, memberId)
      if (!member) throw new RoomInvalidError('not-a-member')
      if (member.role === 'owner') throw new RoomInvalidError('owner-cannot-leave')
      await database.transaction().execute(async (transaction) => {
        await transaction
          .deleteFrom('roomMember')
          .where('roomId', '=', roomId)
          .where('userId', '=', memberId)
          .execute()
        await transaction
          .deleteFrom('roomPresence')
          .where('roomId', 'in', roomSubtree(graph, roomId))
          .where('userId', '=', memberId)
          .execute()
        await recordRoomEvent(transaction, {
          roomId,
          actorUserId: userId,
          action: leaving ? 'member-left' : 'member-removed',
          subjectUserId: memberId,
          metadata: { role: member.role }
        })
        await endRoomSessions(transaction, roomSubtree(graph, roomId))
      })
    },

    /**
     * Makes someone who may already enter the room its owner; the previous owner stays on its list
     * as an editor.
     */
    async transfer(userId: string, roomId: string, targetId: string): Promise<void> {
      const { graph } = await requireRoom(database, userId, roomId, 'owner')
      const target = (await roomRoles(database, graph, roomId)).find(
        (entry) => entry.userId === targetId
      )
      if (!target) throw new RoomInvalidError('not-a-member')
      const owner = await database
        .selectFrom('roomMember')
        .select('userId')
        .where('roomId', '=', roomId)
        .where('role', '=', 'owner')
        .executeTakeFirst()
      if (owner?.userId === targetId) return
      await database.transaction().execute(async (transaction) => {
        if (owner) {
          await transaction
            .updateTable('roomMember')
            .set({ role: 'editor' })
            .where('roomId', '=', roomId)
            .where('userId', '=', owner.userId)
            .execute()
        }
        await transaction
          .insertInto('roomMember')
          .values({ roomId, userId: targetId, role: 'owner', addedBy: userId })
          .onConflict((conflict) =>
            conflict.columns(['roomId', 'userId']).doUpdateSet({ role: 'owner' })
          )
          .execute()
        await recordRoomEvent(transaction, {
          roomId,
          actorUserId: userId,
          action: 'ownership-transferred',
          subjectUserId: targetId,
          metadata: { from: owner?.userId ?? null }
        })
      })
    },

    /** What a room invitation link offers, or null when the id is not one. */
    async preview(invitationId: string, token: string): Promise<InvitationPreview | null> {
      const invitation = await database
        .selectFrom('roomInvitation')
        .innerJoin('room', 'room.id', 'roomInvitation.roomId')
        .select([
          'roomInvitation.emailNormalized',
          'roomInvitation.role',
          'roomInvitation.tokenHash',
          'roomInvitation.expiresAt',
          'roomInvitation.acceptedAt',
          'roomInvitation.revokedAt',
          'roomInvitation.invitedBy',
          'room.name as roomName'
        ])
        .where('roomInvitation.id', '=', invitationId)
        .executeTakeFirst()
      if (!invitation) return null
      if (!invitationTokenIsActive(invitation, token)) throw new RoomInvitationInvalidError()
      return {
        kind: 'room',
        roomName: invitation.roomName,
        role: invitation.role,
        inviterName: (await inviterName(invitation.invitedBy)) ?? 'A Lawha user',
        expiresAt: dateString(invitation.expiresAt) ?? '',
        recipientHint: recipientHint(invitation.emailNormalized)
      }
    },

    /**
     * Joins the room an invitation names, or returns null when the id is not a room invitation.
     * Someone already on the list keeps the role they have.
     */
    async accept(
      actor: CloudActor,
      invitationId: string,
      token: string
    ): Promise<{ roomId: string; role: RoomRole } | null> {
      const invitation = await database
        .selectFrom('roomInvitation')
        .select([
          'roomId',
          'emailNormalized',
          'role',
          'tokenHash',
          'expiresAt',
          'acceptedAt',
          'revokedAt',
          'invitedBy'
        ])
        .where('id', '=', invitationId)
        .executeTakeFirst()
      if (!invitation) return null
      if (
        !invitationMatchesActor(actor, invitation.emailNormalized) ||
        !invitationTokenIsActive(invitation, token)
      ) {
        throw new RoomInvitationInvalidError()
      }
      return database.transaction().execute(async (transaction) => {
        await transaction
          .insertInto('roomMember')
          .values({
            roomId: invitation.roomId,
            userId: actor.userId,
            role: invitation.role,
            addedBy: invitation.invitedBy
          })
          .onConflict((conflict) => conflict.columns(['roomId', 'userId']).doNothing())
          .execute()
        const accepted = await transaction
          .updateTable('roomInvitation')
          .set({ status: 'accepted', acceptedAt: new Date(), acceptedBy: actor.userId })
          .where('id', '=', invitationId)
          .where('status', '=', 'pending')
          .executeTakeFirst()
        if (Number(accepted.numUpdatedRows) === 0) throw new RoomInvitationInvalidError()
        await recordRoomEvent(transaction, {
          roomId: invitation.roomId,
          actorUserId: actor.userId,
          action: 'invitation-accepted',
          subjectUserId: actor.userId,
          subjectEmail: invitation.emailNormalized,
          metadata: { invitationId }
        })
        const member = await transaction
          .selectFrom('roomMember')
          .select('role')
          .where('roomId', '=', invitation.roomId)
          .where('userId', '=', actor.userId)
          .executeTakeFirstOrThrow()
        return { roomId: invitation.roomId, role: member.role }
      })
    }
  }
}

export type RoomMemberService = ReturnType<typeof createRoomMemberService>
