import { afterEach, describe, expect, test } from 'bun:test'

import { FigmaAPI } from '@lawha/core/figma-api'
import {
  ALL_TOOLS,
  isToolExposed,
  setRoomsHost,
  type RoomsHost,
  type RoomsHostRoom
} from '@lawha/core/tools'
import { SceneGraph } from '@lawha/scene-graph'

const figma = new FigmaAPI(new SceneGraph())

function tool(name: string) {
  const found = ALL_TOOLS.find((candidate) => candidate.name === name)
  if (!found) throw new Error(`No tool ${name}`)
  return (args: Record<string, unknown>) => found.execute(figma, args)
}

/** A Cloud server's rooms as the tools see them, refusing what only an owner may do. */
function cloudRooms() {
  const rooms: RoomsHostRoom[] = []
  const invited: Array<{ roomId: string; email: string; role: string }> = []
  const find = (roomId: string) => {
    const room = rooms.find((entry) => entry.id === roomId)
    if (!room) throw new Error('Room not found')
    return room
  }
  const host: RoomsHost = {
    list: async ({ archived }) => rooms.filter((room) => archived || !room.archived),
    workspaces: async () => [{ id: 'workspace-1', name: 'Studio' }],
    create: async (input) => {
      const parent = input.parentId ? find(input.parentId) : null
      const room: RoomsHostRoom = {
        id: `room-${rooms.length + 1}`,
        name: input.name,
        parentId: parent?.id ?? null,
        workspaceId: parent?.workspaceId ?? input.workspaceId ?? '',
        role: 'owner',
        accessMode: parent ? (input.accessMode ?? 'inherit') : 'restricted',
        fileCount: 0,
        archived: false
      }
      rooms.push(room)
      return room
    },
    invite: async (input) => {
      if (find(input.roomId).role !== 'owner') throw new Error('Only the room’s owner can do that')
      invited.push(input)
      return { invitationId: `invitation-${invited.length}`, email: input.email, role: input.role }
    },
    setAccess: async ({ roomId, accessMode }) => {
      const room = find(roomId)
      room.accessMode = accessMode
      return room
    }
  }
  return { rooms, invited, host }
}

let cleanup: (() => void) | null = null
afterEach(() => cleanup?.())

describe('room tools', () => {
  test('are exposed to AI, MCP and WebMCP and only reach the network', () => {
    for (const name of ['list_rooms', 'create_room', 'invite_to_room', 'set_room_access']) {
      const found = ALL_TOOLS.find((candidate) => candidate.name === name)
      expect(found && isToolExposed(found, 'ai') && isToolExposed(found, 'mcp')).toBe(true)
      expect(found?.capabilities).toEqual(['network:access'])
      expect(found?.mutates).toBe(false)
    }
  })

  test('say Cloud is needed when no server is signed in', async () => {
    expect(await tool('list_rooms')({})).toMatchObject({
      error: expect.stringContaining('Lawha Cloud')
    })
  })

  test('create rooms and sub-rooms, invite by email, and set who may enter', async () => {
    const cloud = cloudRooms()
    cleanup = setRoomsHost(cloud.host)
    const top = await tool('create_room')({ name: 'Clients' })
    expect(top).toMatchObject({
      room: { name: 'Clients', workspaceId: 'workspace-1', accessMode: 'restricted' }
    })
    const sub = await tool('create_room')({ name: 'Legal', parentId: 'room-1' })
    expect(sub).toMatchObject({ room: { parentId: 'room-1', accessMode: 'inherit' } })
    expect(await tool('create_room')({ name: 'Loose', accessMode: 'inherit' })).toMatchObject({
      error: expect.any(String)
    })

    expect(
      await tool('invite_to_room')({ roomId: 'room-2', email: ' Bob@Example.com ', role: 'editor' })
    ).toEqual({
      invitation: { invitationId: 'invitation-1', email: 'bob@example.com', role: 'editor' }
    })
    expect(cloud.invited).toEqual([{ roomId: 'room-2', email: 'bob@example.com', role: 'editor' }])

    expect(
      await tool('set_room_access')({ roomId: 'room-2', accessMode: 'restricted' })
    ).toMatchObject({ room: { id: 'room-2', accessMode: 'restricted' } })
    const listed = await tool('list_rooms')({})
    expect(listed).toMatchObject({ rooms: [{ name: 'Clients' }, { name: 'Legal' }] })
  })

  test('report what the server refuses instead of failing the call', async () => {
    const cloud = cloudRooms()
    cleanup = setRoomsHost(cloud.host)
    await tool('create_room')({ name: 'Clients' })
    const room = cloud.rooms[0]
    if (room) room.role = 'viewer'
    expect(await tool('invite_to_room')({ roomId: 'room-1', email: 'bob@example.com' })).toEqual({
      error: 'Only the room’s owner can do that'
    })
    expect(cloud.invited).toEqual([])
  })
})
