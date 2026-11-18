import { describe, expect, test } from 'bun:test'

import { CloudAPIError, createCloudAPIClient } from '#cloud/client'

const roomId = '44444444-4444-4444-8444-444444444444'
const workspaceId = '11111111-1111-4111-8111-111111111111'
const room = {
  id: roomId,
  workspaceId,
  parentId: null,
  name: 'Clients',
  accessMode: 'restricted' as const,
  role: 'owner' as const,
  ownerId: 'alice',
  fileCount: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  archivedAt: null
}

describe('room requests', () => {
  test('lists, creates and updates rooms on the API routes', async () => {
    const requests: Request[] = []
    const client = createCloudAPIClient('https://cloud.example.com/api', {
      fetch: async (input, init) => {
        const request = new Request(input, init)
        requests.push(request)
        if (request.method === 'GET') return Response.json({ rooms: [room] })
        return Response.json({ room }, { status: request.method === 'POST' ? 201 : 200 })
      }
    })
    expect(await client.listRooms({ archived: true })).toEqual([room])
    expect(await client.createRoom({ name: 'Clients', workspaceId })).toEqual(room)
    expect(await client.updateRoom(roomId, { accessMode: 'restricted' })).toEqual(room)
    expect(requests.map((request) => `${request.method} ${request.url}`)).toEqual([
      'GET https://cloud.example.com/api/rooms?archived=true',
      'POST https://cloud.example.com/api/rooms',
      `PATCH https://cloud.example.com/api/rooms/${roomId}`
    ])
  })

  test('rejects a malformed room and keeps the server’s error code', async () => {
    const malformed = createCloudAPIClient('https://cloud.example.com/api', {
      fetch: async () => Response.json({ rooms: [{ ...room, role: 'guest' }] })
    })
    expect(
      await malformed.listRooms().then(
        () => 'parsed',
        () => 'rejected'
      )
    ).toBe('rejected')
    const refused = createCloudAPIClient('https://cloud.example.com/api', {
      fetch: async () => Response.json({ error: { code: 'not_found' } }, { status: 404 })
    })
    const error = await refused.getRoom(roomId).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(CloudAPIError)
    expect(error).toMatchObject({ status: 404 })
  })
})
