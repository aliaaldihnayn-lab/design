import { describe, expect, test } from 'bun:test'

import { createCloudAPIClient } from '#cloud/client'

const documentId = '22222222-2222-4222-8222-222222222222'
const change = {
  id: 'edit-1',
  at: '2026-01-01T10:00:00.000Z',
  sessionId: 'session-1',
  summary: { action: 'move' as const, count: 1, names: ['Card'], label: 'Move' }
}

describe('document history client', () => {
  test('sends edits and reads how many were new', async () => {
    const requests: Request[] = []
    const client = createCloudAPIClient('https://cloud.example.com/api', {
      fetch: async (input, init) => {
        requests.push(new Request(input, init))
        return Response.json({ added: 1 }, { status: 201 })
      }
    })
    expect(await client.appendDocumentHistory(documentId, { changes: [change] })).toBe(1)
    const sent = requests[0]
    expect(sent?.method).toBe('POST')
    expect(new URL(sent?.url ?? '').pathname).toBe(`/api/documents/${documentId}/history`)
    expect(await sent?.clone().json()).toEqual({ changes: [change] })
  })

  test('lists a page of edits with their authors and rejects malformed ones', async () => {
    const listed = { ...change, author: { id: 'alice', name: 'Alice' } }
    let body: unknown = { changes: [listed], nextCursor: null }
    const urls: string[] = []
    const client = createCloudAPIClient('https://cloud.example.com/api', {
      fetch: async (input, init) => {
        urls.push(new Request(input, init).url)
        return Response.json(body)
      }
    })
    expect(await client.listDocumentHistory(documentId, { limit: 20 })).toEqual({
      changes: [listed],
      nextCursor: null
    })
    expect(new URL(urls[0] ?? '').searchParams.get('limit')).toBe('20')

    body = { changes: [{ ...listed, summary: { ...listed.summary, action: 'explode' } }] }
    const failed = await client.listDocumentHistory(documentId).then(
      () => null,
      (error: unknown) => error
    )
    expect(failed).toBeInstanceOf(Error)
  })
})
