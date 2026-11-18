/**
 * The room does not exist, or the person may not enter it; the two answer the same so a room's
 * existence never leaks to someone kept out of it.
 */
export class RoomNotFoundError extends Error {
  constructor() {
    super('Room not found')
    this.name = 'RoomNotFoundError'
  }
}

/** The person may enter the room but their role does not allow this. */
export class RoomForbiddenError extends Error {
  constructor() {
    super('Not allowed in this room')
    this.name = 'RoomForbiddenError'
  }
}

export type RoomInvalidReason =
  | 'top-level-inherit'
  | 'cycle'
  | 'other-workspace'
  | 'owner-cannot-leave'
  | 'not-a-member'
  | 'owner-role'
  | 'empty-update'

/** The change cannot be made as asked. */
export class RoomInvalidError extends Error {
  constructor(readonly reason: RoomInvalidReason) {
    super(`Invalid room change: ${reason}`)
    this.name = 'RoomInvalidError'
  }
}

/** The person invited is already on the room's list. */
export class RoomAlreadyMemberError extends Error {
  constructor() {
    super('Already a member of this room')
    this.name = 'RoomAlreadyMemberError'
  }
}

/** The invitation is unknown, used, withdrawn, expired, or meant for someone else. */
export class RoomInvitationInvalidError extends Error {
  constructor() {
    super('Room invitation is not valid')
    this.name = 'RoomInvitationInvalidError'
  }
}
