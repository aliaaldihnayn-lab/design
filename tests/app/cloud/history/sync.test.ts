import { afterEach, describe, expect, test } from 'bun:test'

import type { DocumentHistoryChangeInput } from '@lawha/cloud/contract'
import { DOCUMENT_HISTORY_BATCH_LIMIT } from '@lawha/cloud/contract'
import type { HistoryChange } from '@lawha/core/history'

import {
  createCloudHistoryQueue,
  type CloudHistoryQueue,
  type CloudHistoryQueueOptions
} from '@/app/cloud/history/sync'
import type { StorageDocumentBinding } from '@/app/integrations/storage/types'

const binding: StorageDocumentBinding = {
  providerId: 'lawha-cloud',
  profileId: 'server',
  containerId: 'workspace',
  documentId: 'document'
}

function change(id: string, label = 'Move'): HistoryChange {
  return {
    id,
    at: Date.UTC(2026, 10, 11),
    sessionId: 'session',
    author: { id: 'ana', name: 'Ana', avatarUrl: null, color: null },
    summary: { action: 'move', count: 1, names: ['Card'], label }
  }
}

const queues: CloudHistoryQueue[] = []
afterEach(() => {
  for (const queue of queues.splice(0)) queue.dispose()
})

/** A queue whose server records each batch, failing while `failing` is set. */
function setup(overrides: Partial<CloudHistoryQueueOptions> = {}) {
  const server = { batches: [] as DocumentHistoryChangeInput[][], failing: false, signedIn: true }
  const queue = createCloudHistoryQueue({
    targetOf: () =>
      server.signedIn
        ? {
            async append(changes) {
              if (server.failing) throw new Error('offline')
              server.batches.push(changes)
            }
          }
        : null,
    delayMs: 1,
    retryMs: 1,
    maxRetryMs: 4,
    onError: () => undefined,
    ...overrides
  })
  queues.push(queue)
  return { queue, server }
}

const wait = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

async function until(condition: () => boolean) {
  for (let attempt = 0; attempt < 500 && !condition(); attempt++) await wait(1)
  if (!condition()) throw new Error('Condition was not met')
}

const ids = (batches: DocumentHistoryChangeInput[][]) => batches.flat().map((sent) => sent.id)

describe('Cloud history upload queue', () => {
  test('sends edits together after a moment, each once, as it ended up', async () => {
    const { queue, server } = setup()
    queue.add(binding, change('a'))
    queue.add(binding, change('b'))
    queue.add(binding, change('a', 'Move again'))
    await until(() => server.batches.length === 1)
    expect(server.batches[0]?.map((sent) => [sent.id, sent.summary.label])).toEqual([
      ['a', 'Move again'],
      ['b', 'Move']
    ])
    expect(queue.size).toBe(0)
  })

  test('splits what waits into batches the server accepts', async () => {
    const { queue, server } = setup()
    for (let index = 0; index < DOCUMENT_HISTORY_BATCH_LIMIT + 5; index++) {
      queue.add(binding, change(`c${index}`))
    }
    await queue.flush()
    expect(server.batches.map((batch) => batch.length)).toEqual([DOCUMENT_HISTORY_BATCH_LIMIT, 5])
  })

  test('keeps edits while offline and sends them once back online', async () => {
    let online = false
    const { queue, server } = setup({ online: () => online })
    queue.add(binding, change('a'))
    await queue.flush()
    expect(server.batches).toEqual([])
    expect(queue.size).toBe(1)
    online = true
    await queue.flush()
    expect(ids(server.batches)).toEqual(['a'])
  })

  test('holds edits back while signed out', async () => {
    const { queue, server } = setup()
    server.signedIn = false
    queue.add(binding, change('a'))
    await queue.flush()
    expect(queue.size).toBe(1)
    server.signedIn = true
    await queue.flush()
    expect(ids(server.batches)).toEqual(['a'])
  })

  test('tries a failed send again on its own, waiting longer each time', async () => {
    const errors: unknown[] = []
    const { queue, server } = setup({ onError: (error) => errors.push(error) })
    server.failing = true
    queue.add(binding, change('a'))
    await until(() => errors.length >= 3)
    expect(queue.size).toBe(1)
    server.failing = false
    await until(() => server.batches.length === 1)
    expect(ids(server.batches)).toEqual(['a'])
    expect(queue.size).toBe(0)
  })

  test('sends an edit changed during its send again, as it is now', async () => {
    let release: (() => void) | null = null
    const sent: DocumentHistoryChangeInput[][] = []
    const queue = createCloudHistoryQueue({
      targetOf: () => ({
        append: (changes) => {
          sent.push(changes)
          if (sent.length > 1) return Promise.resolve()
          return new Promise<void>((resolve) => {
            release = resolve
          })
        }
      }),
      delayMs: 60_000
    })
    queues.push(queue)
    queue.add(binding, change('a'))
    const first = queue.flush()
    queue.add(binding, change('a', 'Move again'))
    release?.()
    await first
    await queue.flush()
    expect(sent.map((batch) => batch.map((input) => input.summary.label))).toEqual([
      ['Move'],
      ['Move again']
    ])
  })
})
