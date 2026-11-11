import { describe, expect, test } from 'bun:test'

import { createCloudTestDatabase } from '#cloud-tests/helpers/database'
import { createMemoryObjectStore } from '#cloud-tests/helpers/objects'
import { responseJSON } from '#cloud-tests/helpers/response'
import { documentHistoryPageSchema } from '#cloud/contract'
import {
  createBetterAuthAdapter,
  createCloudApp,
  parseCloudServerConfig,
  type CloudActor
} from '#cloud/server'
import * as v from 'valibot'

const config = parseCloudServerConfig({
  deployment: 'self-hosted',
  publicURL: 'http://localhost:8787',
  databaseURL: 'postgresql://test:test@localhost/test',
  authSecret: 'integration-test-secret-at-least-32-characters',
  s3Endpoint: 'http://localhost:9000',
  s3Region: 'us-east-1',
  s3Bucket: 'lawha',
  s3AccessKeyId: 'lawha',
  s3SecretAccessKey: 'lawha-secret'
})

const alice: CloudActor = { userId: 'alice', email: 'alice@example.com', name: 'Alice' }
const mallory: CloudActor = { userId: 'mallory', email: 'mallory@example.com', name: 'Mallory' }

async function testApp() {
  const runtime = await createCloudTestDatabase()
  let actor = alice
  const app = createCloudApp({
    config,
    database: runtime.database,
    auth: createBetterAuthAdapter(config, runtime.database),
    objects: createMemoryObjectStore().store,
    resolveSession: async () => actor
  })
  const request = (path: string, init: { method?: string; json?: unknown } = {}) =>
    app.request(`/api${path}`, {
      method: init.method ?? 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: init.json === undefined ? undefined : JSON.stringify(init.json)
    })
  const workspace = await responseJSON(
    await request('/workspaces', { method: 'POST', json: { name: 'Studio' } }),
    v.object({ workspace: v.object({ id: v.string() }) })
  )
  const created = await responseJSON(
    await request(`/workspaces/${workspace.workspace.id}/documents`, {
      method: 'POST',
      json: { name: 'Poster' }
    }),
    v.object({ document: v.object({ id: v.string() }) })
  )
  return {
    request,
    documentId: created.document.id,
    actAs: (next: CloudActor) => {
      actor = next
    }
  }
}

const change = (id: string, at: string, names: string[] = ['Card']) => ({
  id,
  at,
  sessionId: 'session-1',
  summary: { action: 'move', count: names.length, names, label: 'Move' }
})

describe('document history', () => {
  test('keeps edits signed by the person who sent them, newest first', async () => {
    const { request, documentId } = await testApp()
    const appended = await responseJSON(
      await request(`/documents/${documentId}/history`, {
        method: 'POST',
        json: {
          changes: [
            change('a', '2026-01-01T10:00:00.000Z'),
            change('b', '2026-01-01T10:05:00.000Z', ['Card', 'Heading'])
          ]
        }
      }),
      v.object({ added: v.number() })
    )
    expect(appended.added).toBe(2)

    const page = await responseJSON(
      await request(`/documents/${documentId}/history`),
      documentHistoryPageSchema
    )
    expect(page.changes.map((entry) => entry.id)).toEqual(['b', 'a'])
    expect(page.changes[0]).toMatchObject({
      at: '2026-01-01T10:05:00.000Z',
      sessionId: 'session-1',
      summary: { action: 'move', count: 2, names: ['Card', 'Heading'], label: 'Move' },
      author: { id: 'alice' }
    })
    expect(page.nextCursor).toBeNull()
  })

  test('adds an edit sent twice only once, and takes a future time as now', async () => {
    const { request, documentId } = await testApp()
    const send = async (changes: unknown[]) =>
      responseJSON(
        await request(`/documents/${documentId}/history`, { method: 'POST', json: { changes } }),
        v.object({ added: v.number() })
      )
    expect((await send([change('a', '2026-01-01T10:00:00.000Z')])).added).toBe(1)
    expect((await send([change('a', '2026-01-01T10:00:00.000Z')])).added).toBe(0)
    expect((await send([change('future', '2999-01-01T00:00:00.000Z')])).added).toBe(1)
    const page = await responseJSON(
      await request(`/documents/${documentId}/history`),
      documentHistoryPageSchema
    )
    const future = page.changes.find((entry) => entry.id === 'future')
    expect(new Date(future?.at ?? 0).getTime()).toBeLessThanOrEqual(Date.now())
  })

  test('pages older edits through the cursor', async () => {
    const { request, documentId } = await testApp()
    const changes = ['a', 'b', 'c'].map((id, index) =>
      change(id, `2026-01-01T10:0${index}:00.000Z`)
    )
    await request(`/documents/${documentId}/history`, { method: 'POST', json: { changes } })
    const first = await responseJSON(
      await request(`/documents/${documentId}/history?limit=2`),
      documentHistoryPageSchema
    )
    expect(first.changes.map((entry) => entry.id)).toEqual(['c', 'b'])
    if (!first.nextCursor) throw new Error('expected another page')
    const second = await responseJSON(
      await request(`/documents/${documentId}/history?limit=2&before=${first.nextCursor}`),
      documentHistoryPageSchema
    )
    expect(second.changes.map((entry) => entry.id)).toEqual(['a'])
    expect(second.nextCursor).toBeNull()
  })

  test('refuses malformed edits and people without access to the document', async () => {
    const { request, documentId, actAs } = await testApp()
    const malformed = await request(`/documents/${documentId}/history`, {
      method: 'POST',
      json: { changes: [{ ...change('a', 'yesterday') }] }
    })
    expect(malformed.status).toBe(400)
    const empty = await request(`/documents/${documentId}/history`, {
      method: 'POST',
      json: { changes: [] }
    })
    expect(empty.status).toBe(400)

    actAs(mallory)
    expect((await request(`/documents/${documentId}/history`)).status).toBe(404)
    const write = await request(`/documents/${documentId}/history`, {
      method: 'POST',
      json: { changes: [change('x', '2026-01-01T10:00:00.000Z')] }
    })
    expect(write.status).toBe(404)
  })
})
