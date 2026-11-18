import {
  createdRoomInvitationSchema,
  documentSummarySchema,
  roomAuditSchema,
  roomDetailSchema,
  roomFileSchema,
  roomMembersSchema,
  roomPresenceSchema,
  roomPresenceTicketSchema,
  roomSummarySchema,
  roomTreeSchema,
  type CreatedRoomInvitation,
  type CreateDocumentRequest,
  type CreateRoomInput,
  type CreateRoomInvitationInput,
  type DocumentSummary,
  type RoomAudit,
  type RoomDetail,
  type RoomFile,
  type RoomMemberRole,
  type RoomMembers,
  type RoomPresence,
  type RoomPresenceTicket,
  type RoomSummary,
  type UpdateRoomInput
} from '#cloud/contract'
import type { CloudAPI } from '#cloud/server/api'
import type { hc } from 'hono/client'
import * as v from 'valibot'

import { parseResponse, responseBody, type CloudClientDiagnostic } from './response'

const roomResponseSchema = v.object({ room: roomSummarySchema })
const fileResponseSchema = v.object({ file: roomFileSchema })
const documentResponseSchema = v.object({ document: documentSummarySchema })

/** Rooms, their files and sub-rooms, who may enter them, and who is in them now. */
export function createRoomRequests(
  client: ReturnType<typeof hc<CloudAPI>>,
  onDiagnostic?: CloudClientDiagnostic
) {
  const room = client.rooms[':roomId']
  return {
    /** Every room the person may enter, flat; archived ones only when asked. */
    async listRooms(options: { archived?: boolean } = {}): Promise<RoomSummary[]> {
      const response = await parseResponse(
        client.rooms.$get({ query: options.archived ? { archived: 'true' } : {} }),
        roomTreeSchema,
        onDiagnostic
      )
      return response.rooms
    },
    async getRoom(roomId: string): Promise<RoomDetail> {
      return parseResponse(room.$get({ param: { roomId } }), roomDetailSchema, onDiagnostic)
    },
    async createRoom(input: CreateRoomInput): Promise<RoomSummary> {
      const response = await parseResponse(
        client.rooms.$post({ json: input }),
        roomResponseSchema,
        onDiagnostic
      )
      return response.room
    },
    /** Renames, sets who may enter, or archives and restores a room. */
    async updateRoom(roomId: string, input: UpdateRoomInput): Promise<RoomSummary> {
      const response = await parseResponse(
        room.$patch({ param: { roomId }, json: input }),
        roomResponseSchema,
        onDiagnostic
      )
      return response.room
    },
    async moveRoom(roomId: string, parentId: string | null): Promise<RoomSummary> {
      const response = await parseResponse(
        room.move.$post({ param: { roomId }, json: { parentId } }),
        roomResponseSchema,
        onDiagnostic
      )
      return response.room
    },
    async listRoomMembers(roomId: string): Promise<RoomMembers> {
      return parseResponse(
        room.members.$get({ param: { roomId } }),
        roomMembersSchema,
        onDiagnostic
      )
    },
    async inviteToRoom(
      roomId: string,
      input: CreateRoomInvitationInput
    ): Promise<CreatedRoomInvitation> {
      return parseResponse(
        room.invitations.$post({ param: { roomId }, json: input }),
        createdRoomInvitationSchema,
        onDiagnostic
      )
    },
    async revokeRoomInvitation(roomId: string, invitationId: string): Promise<void> {
      await responseBody(
        await room.invitations[':invitationId'].$delete({ param: { roomId, invitationId } }),
        onDiagnostic
      )
    },
    async updateRoomMember(roomId: string, userId: string, role: RoomMemberRole): Promise<void> {
      await responseBody(
        await room.members[':userId'].$patch({ param: { roomId, userId }, json: { role } }),
        onDiagnostic
      )
    },
    async removeRoomMember(roomId: string, userId: string): Promise<void> {
      await responseBody(
        await room.members[':userId'].$delete({ param: { roomId, userId } }),
        onDiagnostic
      )
    },
    async leaveRoom(roomId: string): Promise<void> {
      await responseBody(await room.leave.$post({ param: { roomId } }), onDiagnostic)
    },
    async transferRoom(roomId: string, userId: string): Promise<void> {
      await responseBody(
        await room.transfer.$post({ param: { roomId }, json: { userId } }),
        onDiagnostic
      )
    },
    /** Puts a document in a room, moving it out of any room it was in. */
    async addRoomFile(roomId: string, documentId: string): Promise<RoomFile> {
      const response = await parseResponse(
        room.files.$post({ param: { roomId }, json: { documentId } }),
        fileResponseSchema,
        onDiagnostic
      )
      return response.file
    },
    async removeRoomFile(roomId: string, documentId: string): Promise<void> {
      await responseBody(
        await room.files[':documentId'].$delete({ param: { roomId, documentId } }),
        onDiagnostic
      )
    },
    async createRoomDocument(
      roomId: string,
      input: CreateDocumentRequest
    ): Promise<DocumentSummary> {
      const response = await parseResponse(
        room.documents.$post({
          param: { roomId },
          json: { ...input, kind: input.kind ?? 'design' }
        }),
        documentResponseSchema,
        onDiagnostic
      )
      return response.document
    },
    async getRoomAudit(roomId: string): Promise<RoomAudit> {
      return parseResponse(room.audit.$get({ param: { roomId } }), roomAuditSchema, onDiagnostic)
    },
    /** Checks in to a room and answers who is in it now. */
    async roomHeartbeat(roomId: string): Promise<RoomPresence> {
      return parseResponse(
        room.presence.$post({ param: { roomId } }),
        roomPresenceSchema,
        onDiagnostic
      )
    },
    /** A ticket for the relay's live presence channel of the room. */
    async roomPresenceTicket(roomId: string): Promise<RoomPresenceTicket> {
      return parseResponse(
        room.presence.ticket.$post({ param: { roomId } }),
        roomPresenceTicketSchema,
        onDiagnostic
      )
    },
    async leaveRoomPresence(roomId: string): Promise<void> {
      await responseBody(await room.presence.$delete({ param: { roomId } }), onDiagnostic)
    }
  }
}
