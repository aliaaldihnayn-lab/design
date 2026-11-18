import type { CloudAPIClient } from '@lawha/cloud/client'
import type { RoomSummary } from '@lawha/cloud/contract'
import { setRoomsHost, type RoomsHostRoom } from '@lawha/core/tools'

import { homeCloudServer } from '../servers/store'
import { cloudAPIClient, cloudConnection } from '../sessions/connection'
import { roomFailureOf, type RoomFailure } from './store'

/** What the AI is told when the server refuses a room change; it reads English. */
const FAILURE_MESSAGES: Record<RoomFailure, string> = {
  forbidden: 'Only the room’s owner can do that',
  'not-found': 'No room with that id that the person can enter',
  invalid: 'That change is not possible for this room',
  'already-member': 'That person is already a member of this room',
  unavailable: 'The Lawha Cloud server did not answer'
}

function hostRoom(room: RoomSummary): RoomsHostRoom {
  return {
    id: room.id,
    name: room.name,
    parentId: room.parentId,
    workspaceId: room.workspaceId,
    role: room.role,
    accessMode: room.accessMode,
    fileCount: room.fileCount,
    archived: room.archivedAt !== null
  }
}

/** The signed-in client of the server Home shows, as the person, or why there is none. */
function signedIn(): {
  client: CloudAPIClient
  workspaces: { id: string; name: string; role: string }[]
} {
  const server = homeCloudServer.value
  const connection = server ? cloudConnection(server.id) : null
  if (!server || connection?.state !== 'signed-in' || !connection.discovery) {
    throw new Error('Rooms need a Lawha Cloud server: sign in to one on Home first')
  }
  return { client: cloudAPIClient(server, connection.discovery), workspaces: connection.workspaces }
}

async function asPerson<T>(action: (client: CloudAPIClient) => Promise<T>): Promise<T> {
  const { client } = signedIn()
  try {
    return await action(client)
  } catch (error) {
    throw new Error(FAILURE_MESSAGES[roomFailureOf(error)], { cause: error })
  }
}

/**
 * Lets the AI, MCP and WebMCP room tools act on the rooms of the server Home shows, as the
 * signed-in person; the server checks every call against their role in the room.
 */
export function registerCloudRoomTools(): () => void {
  return setRoomsHost({
    list: ({ archived }) =>
      asPerson(async (client) => (await client.listRooms({ archived })).map(hostRoom)),
    workspaces: async () =>
      signedIn()
        .workspaces.filter((workspace) => workspace.role !== 'viewer')
        .map(({ id, name }) => ({ id, name })),
    create: (input) => asPerson(async (client) => hostRoom(await client.createRoom(input))),
    invite: ({ roomId, email, role }) =>
      asPerson(async (client) => {
        // The link carries the invitation's secret, so it goes only by email, never to the model.
        const { invitation } = await client.inviteToRoom(roomId, { email, role })
        return { invitationId: invitation.id, email: invitation.email, role: invitation.role }
      }),
    setAccess: ({ roomId, accessMode }) =>
      asPerson(async (client) => hostRoom(await client.updateRoom(roomId, { accessMode })))
  })
}
