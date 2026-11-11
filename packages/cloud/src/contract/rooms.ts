import * as v from 'valibot'

import { documentSummarySchema } from './documents'

const idSchema = v.pipe(v.string(), v.uuid())
const roomNameSchema = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(100))

/** What someone may do in a room: run it, add and change its files, or only look. */
export const roomRoleSchema = v.picklist(['owner', 'editor', 'viewer'])
export type RoomRole = v.InferOutput<typeof roomRoleSchema>

/** The roles an invitation or a role change may give; a room has one owner, by transfer. */
export const roomMemberRoleSchema = v.picklist(['editor', 'viewer'])
export type RoomMemberRole = v.InferOutput<typeof roomMemberRoleSchema>

/**
 * Who may enter a sub-room: everyone who may enter its parent, or only its own member list. A
 * top-level room is always `restricted`.
 */
export const roomAccessModeSchema = v.picklist(['inherit', 'restricted'])
export type RoomAccessMode = v.InferOutput<typeof roomAccessModeSchema>

/** A room the person may enter, with their role in it. */
export const roomSummarySchema = v.object({
  id: idSchema,
  workspaceId: idSchema,
  /** The parent room, or null for a top-level room or one whose parent the person cannot enter. */
  parentId: v.nullable(idSchema),
  name: v.string(),
  accessMode: roomAccessModeSchema,
  role: roomRoleSchema,
  ownerId: v.string(),
  fileCount: v.pipe(v.number(), v.integer(), v.minValue(0)),
  createdAt: v.string(),
  updatedAt: v.string(),
  archivedAt: v.nullable(v.string())
})
export type RoomSummary = v.InferOutput<typeof roomSummarySchema>

/** Every room the person may enter, flat; the client builds the tree from `parentId`. */
export const roomTreeSchema = v.object({ rooms: v.array(roomSummarySchema) })
export type RoomTree = v.InferOutput<typeof roomTreeSchema>

/** A file in a room: a Cloud document of any kind, and who put it there. */
export const roomFileSchema = v.object({
  document: documentSummarySchema,
  addedBy: v.string(),
  addedAt: v.string()
})
export type RoomFile = v.InferOutput<typeof roomFileSchema>

/** One room: its place in the tree the person can see, its sub-rooms, and its files. */
export const roomDetailSchema = v.object({
  room: roomSummarySchema,
  /** The ancestors the person may enter, outermost first. */
  path: v.array(v.object({ id: idSchema, name: v.string() })),
  children: v.array(roomSummarySchema),
  files: v.array(roomFileSchema)
})
export type RoomDetail = v.InferOutput<typeof roomDetailSchema>

export const createRoomSchema = v.object({
  name: roomNameSchema,
  /** The workspace a top-level room goes in; a sub-room is in its parent's. */
  workspaceId: v.optional(idSchema),
  parentId: v.optional(v.nullable(idSchema)),
  /** For a sub-room; inherits unless said otherwise. */
  accessMode: v.optional(roomAccessModeSchema)
})
export type CreateRoomInput = v.InferOutput<typeof createRoomSchema>

export const updateRoomSchema = v.object({
  name: v.optional(roomNameSchema),
  accessMode: v.optional(roomAccessModeSchema),
  archived: v.optional(v.boolean())
})
export type UpdateRoomInput = v.InferOutput<typeof updateRoomSchema>

/** Moves a room under another in the same workspace, or to the top with a null parent. */
export const moveRoomSchema = v.object({ parentId: v.nullable(idSchema) })
export type MoveRoomInput = v.InferOutput<typeof moveRoomSchema>

/** Someone who may enter a room: on its own list, or through a parent it inherits from. */
export const roomMemberSchema = v.object({
  userId: v.string(),
  name: v.string(),
  email: v.string(),
  image: v.nullable(v.string()),
  role: roomRoleSchema,
  /** The room whose list names them: this one, or the ancestor it inherits from. */
  source: v.picklist(['direct', 'inherited']),
  joinedAt: v.string()
})
export type RoomMember = v.InferOutput<typeof roomMemberSchema>

export const roomInvitationStatusSchema = v.picklist(['pending', 'accepted', 'revoked', 'expired'])
export type RoomInvitationStatus = v.InferOutput<typeof roomInvitationStatusSchema>

export const roomInvitationSchema = v.object({
  id: idSchema,
  email: v.string(),
  role: roomMemberRoleSchema,
  status: roomInvitationStatusSchema,
  invitedBy: v.object({ id: v.string(), name: v.nullable(v.string()) }),
  invitedAt: v.string(),
  expiresAt: v.string()
})
export type RoomInvitation = v.InferOutput<typeof roomInvitationSchema>

export const roomMembersSchema = v.object({
  members: v.array(roomMemberSchema),
  /** Only the owner sees invitations. */
  invitations: v.array(roomInvitationSchema)
})
export type RoomMembers = v.InferOutput<typeof roomMembersSchema>

export const createRoomInvitationSchema = v.object({
  email: v.pipe(v.string(), v.trim(), v.toLowerCase(), v.email()),
  role: roomMemberRoleSchema
})
export type CreateRoomInvitationInput = v.InferOutput<typeof createRoomInvitationSchema>

/** A new invitation and its link, for the owner to pass on when email is off. */
export const createdRoomInvitationSchema = v.object({
  invitation: roomInvitationSchema,
  acceptanceURL: v.string()
})
export type CreatedRoomInvitation = v.InferOutput<typeof createdRoomInvitationSchema>

export const updateRoomMemberSchema = v.object({ role: roomMemberRoleSchema })
export type UpdateRoomMemberInput = v.InferOutput<typeof updateRoomMemberSchema>

export const transferRoomSchema = v.object({ userId: v.pipe(v.string(), v.minLength(1)) })
export type TransferRoomInput = v.InferOutput<typeof transferRoomSchema>

/** Puts a document in a room, moving it from any room it was in. */
export const addRoomFileSchema = v.object({ documentId: idSchema })
export type AddRoomFileInput = v.InferOutput<typeof addRoomFileSchema>

/** What a room's audit trail records about who may enter it. */
export const roomAuditActionSchema = v.picklist([
  'room-created',
  'member-invited',
  'invitation-revoked',
  'invitation-accepted',
  'role-changed',
  'member-removed',
  'member-left',
  'ownership-transferred',
  'access-changed',
  'room-moved',
  'room-archived',
  'room-restored'
])
export type RoomAuditAction = v.InferOutput<typeof roomAuditActionSchema>

export const roomAuditEventSchema = v.object({
  id: idSchema,
  action: roomAuditActionSchema,
  actor: v.object({ id: v.string(), name: v.nullable(v.string()) }),
  subjectUserId: v.nullable(v.string()),
  subjectEmail: v.nullable(v.string()),
  metadata: v.record(v.string(), v.unknown()),
  createdAt: v.string()
})
export type RoomAuditEvent = v.InferOutput<typeof roomAuditEventSchema>

export const roomAuditSchema = v.object({ events: v.array(roomAuditEventSchema) })
export type RoomAudit = v.InferOutput<typeof roomAuditSchema>

/** Who is in a room now: everyone whose client checked in within `ROOM_PRESENCE_WINDOW_MS`. */
export const roomPresenceSchema = v.object({
  people: v.array(
    v.object({
      userId: v.string(),
      name: v.string(),
      image: v.nullable(v.string()),
      seenAt: v.string()
    })
  )
})
export type RoomPresence = v.InferOutput<typeof roomPresenceSchema>

/** How often a client in a room checks in; Cloud has no realtime channel outside documents. */
export const ROOM_PRESENCE_INTERVAL_MS = 15_000
/** How long a check-in counts as being in the room. */
export const ROOM_PRESENCE_WINDOW_MS = 45_000

export function parseCreateRoom(input: unknown): CreateRoomInput {
  return v.parse(createRoomSchema, input)
}

export function parseUpdateRoom(input: unknown): UpdateRoomInput {
  return v.parse(updateRoomSchema, input)
}

export function parseMoveRoom(input: unknown): MoveRoomInput {
  return v.parse(moveRoomSchema, input)
}

export function parseCreateRoomInvitation(input: unknown): CreateRoomInvitationInput {
  return v.parse(createRoomInvitationSchema, input)
}

export function parseUpdateRoomMember(input: unknown): UpdateRoomMemberInput {
  return v.parse(updateRoomMemberSchema, input)
}

export function parseTransferRoom(input: unknown): TransferRoomInput {
  return v.parse(transferRoomSchema, input)
}

export function parseAddRoomFile(input: unknown): AddRoomFileInput {
  return v.parse(addRoomFileSchema, input)
}
