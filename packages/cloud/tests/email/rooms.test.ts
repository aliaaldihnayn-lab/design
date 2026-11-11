import { describe, expect, test } from 'bun:test'

import { renderTransactionalEmail } from '#cloud/email'

describe('room invitation email', () => {
  test('names the room, the inviter and the role, and links to the invitation', async () => {
    const acceptanceURL = 'https://cloud.example.com/invitations/abc#secret'
    const rendered = await renderTransactionalEmail({
      kind: 'room-invitation',
      payload: {
        inviterName: 'Alice',
        roomName: 'Clients',
        role: 'viewer',
        expiresAt: '2026-11-18T00:00:00.000Z',
        acceptanceURL
      }
    })
    expect(rendered.subject).toBe('Alice invited you to the room Clients')
    expect(rendered.text).toContain('view the room “Clients”')
    expect(rendered.html).toContain(acceptanceURL)
    expect(rendered.text).toContain(acceptanceURL)
  })
})
