import * as v from 'valibot'

import { defineTool } from '#core/tools/schema'

import { requireRoomsHost } from './host'

const accessModeSchema = v.pipe(
  v.picklist(['inherit', 'restricted']),
  v.description(
    "'inherit': everyone who may enter the parent room may enter this one with the same role. " +
      "'restricted': only people invited to this room (and owners of rooms above it)."
  )
)

/** Runs a host call, reporting what the server refused as the result instead of throwing. */
async function hosted<T>(action: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await action()
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

export const listRooms = defineTool({
  name: 'list_rooms',
  description:
    'List the Lawha Cloud rooms the signed-in person may enter, as a flat list with parentId ' +
    '(nested sub-rooms at any depth), each with the person’s role (owner, editor, viewer), ' +
    'whether it inherits access from its parent or is restricted, and how many files it holds. ' +
    'Rooms the person cannot enter are never listed.',
  execution: { kind: 'async', mutation: 'none' },
  capabilities: ['network:access'],
  input: v.strictObject({
    archived: v.optional(v.pipe(v.boolean(), v.description('Include archived rooms.')), false)
  }),
  execute: async (_figma, { archived }) =>
    hosted(async () => ({ rooms: await requireRoomsHost().list({ archived }) }))
})

export const createRoom = defineTool({
  name: 'create_room',
  description:
    'Create a Lawha Cloud room. Give parentId to make a sub-room of a room the person edits ' +
    '(it inherits access unless accessMode is restricted); without parentId it is a top-level ' +
    'room, which is always restricted, in workspaceId or the person’s first writable workspace. ' +
    'The person becomes its owner.',
  execution: { kind: 'async', mutation: 'none' },
  capabilities: ['network:access'],
  input: v.strictObject({
    name: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(100)),
    parentId: v.optional(
      v.pipe(v.string(), v.description('The room to put it in, from list_rooms.'))
    ),
    workspaceId: v.optional(v.string()),
    accessMode: v.optional(accessModeSchema)
  }),
  execute: async (_figma, input) =>
    hosted(async () => {
      const rooms = requireRoomsHost()
      if (input.parentId) {
        return {
          room: await rooms.create({
            name: input.name,
            parentId: input.parentId,
            accessMode: input.accessMode
          })
        }
      }
      if (input.accessMode === 'inherit') {
        throw new Error('A top-level room has no parent to inherit from; it is always restricted')
      }
      const workspaceId = input.workspaceId ?? (await rooms.workspaces()).at(0)?.id
      if (!workspaceId) throw new Error('The person writes in no workspace, so cannot make a room')
      return { room: await rooms.create({ name: input.name, workspaceId }) }
    })
})

export const inviteToRoom = defineTool({
  name: 'invite_to_room',
  description:
    'Invite someone by email to a Lawha Cloud room as an editor or viewer. Only the room’s ' +
    'owner may invite. The server emails them a link that works only for that address and ' +
    'expires after a week; a newer invitation to the same address replaces the older.',
  execution: { kind: 'async', mutation: 'none' },
  capabilities: ['network:access'],
  input: v.strictObject({
    roomId: v.string(),
    email: v.pipe(v.string(), v.trim(), v.toLowerCase(), v.email()),
    role: v.optional(v.picklist(['editor', 'viewer']), 'viewer')
  }),
  execute: async (_figma, input) =>
    hosted(async () => ({ invitation: await requireRoomsHost().invite(input) }))
})

export const setRoomAccess = defineTool({
  name: 'set_room_access',
  description:
    'Choose who may enter a Lawha Cloud sub-room: inherit from its parent room, or restrict it ' +
    'to its own member list. Only the room’s owner may change it; a top-level room is always ' +
    'restricted. People who lose access are dropped from its open files.',
  execution: { kind: 'async', mutation: 'none' },
  capabilities: ['network:access'],
  input: v.strictObject({ roomId: v.string(), accessMode: accessModeSchema }),
  execute: async (_figma, input) =>
    hosted(async () => ({ room: await requireRoomsHost().setAccess(input) }))
})
