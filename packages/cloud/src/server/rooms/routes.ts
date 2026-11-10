import {
  parseAddRoomFile,
  parseCreateDocument,
  parseCreateRoom,
  parseCreateRoomInvitation,
  parseMoveRoom,
  parseTransferRoom,
  parseUpdateRoom,
  parseUpdateRoomMember
} from '#cloud/contract'
import type { CloudActor } from '#cloud/server/auth'
import type { CloudDatabase } from '#cloud/server/db'
import { CLOUD_RATE_LIMITS, createRouteRateLimiter } from '#cloud/server/rate-limit'
import { validatedJSON } from '#cloud/server/validation'
import { Hono, type Context } from 'hono'
import type { Kysely } from 'kysely'

import {
  RoomAlreadyMemberError,
  RoomForbiddenError,
  RoomInvalidError,
  RoomNotFoundError
} from './errors'
import type { RoomMemberService } from './members'
import type { RoomService } from './service'

export type RoomRouteEnvironment = {
  Variables: {
    actor: CloudActor
  }
}

/** Runs a room action, answering its domain errors with their HTTP codes. */
async function roomRoute<T>(context: Context, action: () => Promise<T>): Promise<T | Response> {
  try {
    return await action()
  } catch (error) {
    if (error instanceof RoomNotFoundError) {
      return context.json({ error: { code: 'not_found' as const } }, 404)
    }
    if (error instanceof RoomForbiddenError) {
      return context.json({ error: { code: 'forbidden' as const } }, 403)
    }
    if (error instanceof RoomAlreadyMemberError) {
      return context.json({ error: { code: 'already_member' as const } }, 409)
    }
    if (error instanceof RoomInvalidError) {
      return context.json({ error: { code: 'invalid' as const, reason: error.reason } }, 422)
    }
    throw error
  }
}

export function createRoomRoutes(
  rooms: RoomService,
  members: RoomMemberService,
  rateLimit?: { database: Kysely<CloudDatabase>; secret: string }
) {
  const router = new Hono<RoomRouteEnvironment>()
  if (rateLimit) {
    router.use(
      '/:roomId/invitations',
      createRouteRateLimiter(
        rateLimit.database,
        rateLimit.secret,
        CLOUD_RATE_LIMITS.invitationMutation,
        (context) => context.req.method !== 'POST',
        (context) => context.req.param('roomId') ?? 'unknown'
      )
    )
  }
  const actorId = (context: Context<RoomRouteEnvironment>) => context.get('actor').userId
  return router
    .get('/', async (context) =>
      context.json({
        rooms: await rooms.tree(actorId(context), {
          archived: context.req.query('archived') === 'true'
        })
      })
    )
    .post('/', validatedJSON(parseCreateRoom), (context) =>
      roomRoute(context, async () =>
        context.json({ room: await rooms.create(actorId(context), context.req.valid('json')) }, 201)
      )
    )
    .get('/:roomId', (context) =>
      roomRoute(context, async () =>
        context.json(await rooms.get(actorId(context), context.req.param('roomId')))
      )
    )
    .patch('/:roomId', validatedJSON(parseUpdateRoom), (context) =>
      roomRoute(context, async () =>
        context.json({
          room: await rooms.update(
            actorId(context),
            context.req.param('roomId'),
            context.req.valid('json')
          )
        })
      )
    )
    .post('/:roomId/move', validatedJSON(parseMoveRoom), (context) =>
      roomRoute(context, async () =>
        context.json({
          room: await rooms.move(
            actorId(context),
            context.req.param('roomId'),
            context.req.valid('json')
          )
        })
      )
    )
    .get('/:roomId/members', (context) =>
      roomRoute(context, async () =>
        context.json(await members.list(actorId(context), context.req.param('roomId')))
      )
    )
    .post('/:roomId/invitations', validatedJSON(parseCreateRoomInvitation), (context) =>
      roomRoute(context, async () =>
        context.json(
          await members.invite(
            actorId(context),
            context.req.param('roomId'),
            context.req.valid('json')
          ),
          201
        )
      )
    )
    .delete('/:roomId/invitations/:invitationId', (context) =>
      roomRoute(context, async () => {
        await members.revokeInvitation(
          actorId(context),
          context.req.param('roomId'),
          context.req.param('invitationId')
        )
        return context.body(null, 204)
      })
    )
    .patch('/:roomId/members/:userId', validatedJSON(parseUpdateRoomMember), (context) =>
      roomRoute(context, async () => {
        await members.updateRole(
          actorId(context),
          context.req.param('roomId'),
          context.req.param('userId'),
          context.req.valid('json').role
        )
        return context.body(null, 204)
      })
    )
    .delete('/:roomId/members/:userId', (context) =>
      roomRoute(context, async () => {
        await members.remove(
          actorId(context),
          context.req.param('roomId'),
          context.req.param('userId')
        )
        return context.body(null, 204)
      })
    )
    .post('/:roomId/leave', (context) =>
      roomRoute(context, async () => {
        await members.remove(actorId(context), context.req.param('roomId'), actorId(context))
        return context.body(null, 204)
      })
    )
    .post('/:roomId/transfer', validatedJSON(parseTransferRoom), (context) =>
      roomRoute(context, async () => {
        await members.transfer(
          actorId(context),
          context.req.param('roomId'),
          context.req.valid('json').userId
        )
        return context.body(null, 204)
      })
    )
    .post('/:roomId/files', validatedJSON(parseAddRoomFile), (context) =>
      roomRoute(context, async () =>
        context.json(
          {
            file: await rooms.addFile(
              actorId(context),
              context.req.param('roomId'),
              context.req.valid('json').documentId
            )
          },
          201
        )
      )
    )
    .delete('/:roomId/files/:documentId', (context) =>
      roomRoute(context, async () => {
        await rooms.removeFile(
          actorId(context),
          context.req.param('roomId'),
          context.req.param('documentId')
        )
        return context.body(null, 204)
      })
    )
    .post('/:roomId/documents', validatedJSON(parseCreateDocument), (context) =>
      roomRoute(context, async () =>
        context.json(
          {
            document: await rooms.createDocument(
              actorId(context),
              context.req.param('roomId'),
              context.req.valid('json')
            )
          },
          201
        )
      )
    )
    .get('/:roomId/audit', (context) =>
      roomRoute(context, async () =>
        context.json(await rooms.audit(actorId(context), context.req.param('roomId')))
      )
    )
    .get('/:roomId/presence', (context) =>
      roomRoute(context, async () =>
        context.json(await rooms.presence(actorId(context), context.req.param('roomId')))
      )
    )
    .post('/:roomId/presence', (context) =>
      roomRoute(context, async () =>
        context.json(await rooms.heartbeat(actorId(context), context.req.param('roomId')))
      )
    )
    .delete('/:roomId/presence', (context) =>
      roomRoute(context, async () => {
        await rooms.leavePresence(actorId(context), context.req.param('roomId'))
        return context.body(null, 204)
      })
    )
}
