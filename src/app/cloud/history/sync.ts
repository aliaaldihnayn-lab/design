import type { DocumentHistoryChangeInput } from '@lawha/cloud/contract'
import { DOCUMENT_HISTORY_BATCH_LIMIT } from '@lawha/cloud/contract'
import type { HistoryChange } from '@lawha/core/history'

import { onDesignHistoryRecorded } from '@/app/history/design'
import type { StorageDocumentBinding } from '@/app/integrations/storage/types'
import { IS_BROWSER } from '@/constants'

import { isCloudBinding } from '../documents/status'
import { cloudShareTarget } from '../sharing/document'

/** Edits wait this long for others before they are sent together. */
export const CLOUD_HISTORY_SEND_DELAY_MS = 3000
/** After a failed send the queue waits this long, doubling up to the most, before it tries again. */
export const CLOUD_HISTORY_RETRY_MS = 5000
export const CLOUD_HISTORY_MAX_RETRY_MS = 5 * 60 * 1000

/** Where one document's edits go: its server's append call for it. */
export type CloudHistoryTarget = {
  append(changes: DocumentHistoryChangeInput[]): Promise<unknown>
}

export type CloudHistoryQueueOptions = {
  /** The document's target while its server is signed in; null holds its edits back. */
  targetOf: (binding: StorageDocumentBinding) => CloudHistoryTarget | null
  /** Whether the device is online; while it is not, nothing is sent. */
  online?: () => boolean
  delayMs?: number
  retryMs?: number
  maxRetryMs?: number
  onError?: (error: unknown) => void
}

type Pending = { binding: StorageDocumentBinding; changes: DocumentHistoryChangeInput[] }

const keyOf = (binding: StorageDocumentBinding) =>
  `${binding.profileId ?? ''}:${binding.documentId}`

function inputOf(change: HistoryChange): DocumentHistoryChangeInput {
  return {
    id: change.id,
    at: new Date(change.at).toISOString(),
    sessionId: change.sessionId,
    summary: change.summary
  }
}

export type CloudHistoryQueue = ReturnType<typeof createCloudHistoryQueue>

/**
 * The edits of Cloud documents waiting to reach their servers. Edits wait a moment for others and
 * go in batches the server accepts; an edit changed again before it was sent goes once, as it
 * ends up. What fails, or waits while the device is offline or signed out, stays queued and is
 * tried again later, waiting longer after each failure, and at once when the device is online.
 * The server keeps each edit once by its id, so sending one twice adds nothing.
 */
export function createCloudHistoryQueue(options: CloudHistoryQueueOptions) {
  const delayMs = options.delayMs ?? CLOUD_HISTORY_SEND_DELAY_MS
  const retryMs = options.retryMs ?? CLOUD_HISTORY_RETRY_MS
  const maxRetryMs = options.maxRetryMs ?? CLOUD_HISTORY_MAX_RETRY_MS
  const online = options.online ?? (() => true)
  const onError =
    options.onError ??
    ((error: unknown) => console.warn('[Cloud] Sending the document history failed:', error))
  const pending = new Map<string, Pending>()
  let timer: ReturnType<typeof setTimeout> | null = null
  let failures = 0
  let flushing: Promise<void> | null = null

  function schedule(wait: number) {
    if (timer) return
    timer = setTimeout(() => {
      timer = null
      void flush()
    }, wait)
  }

  async function send(): Promise<void> {
    if (!online()) return
    let failed = false
    for (const [key, entry] of pending) {
      const target = options.targetOf(entry.binding)
      if (!target) continue
      while (entry.changes.length > 0) {
        const batch = entry.changes.slice(0, DOCUMENT_HISTORY_BATCH_LIMIT)
        try {
          await target.append(batch)
        } catch (error) {
          onError(error)
          failed = true
          break
        }
        // Edits that changed while the batch was in flight are sent again as they are now.
        const sent = new Map(batch.map((change) => [change.id, change]))
        entry.changes = entry.changes.filter((change) => sent.get(change.id) !== change)
      }
      if (entry.changes.length === 0) pending.delete(key)
      if (failed) break
    }
    failures = failed ? failures + 1 : 0
  }

  /** Sends what is waiting now; one send runs at a time. */
  async function flush(): Promise<void> {
    if (timer) clearTimeout(timer)
    timer = null
    if (flushing) {
      await flushing
      if (pending.size === 0) return
    }
    flushing = send()
    try {
      await flushing
    } finally {
      flushing = null
    }
    if (pending.size === 0) return
    const ready = [...pending.values()].some((entry) => options.targetOf(entry.binding))
    if (failures > 0) schedule(Math.min(retryMs * 2 ** (failures - 1), maxRetryMs))
    else if (ready && online()) schedule(delayMs)
  }

  return {
    /** Queues an edit of a Cloud document; edits of other documents stay local. */
    add(binding: StorageDocumentBinding, change: HistoryChange): void {
      const key = keyOf(binding)
      const entry = pending.get(key) ?? { binding, changes: [] }
      entry.binding = binding
      const index = entry.changes.findIndex((existing) => existing.id === change.id)
      // A change folded into the one before it is sent as it ends up.
      if (index === -1) entry.changes.push(inputOf(change))
      else entry.changes[index] = inputOf(change)
      pending.set(key, entry)
      schedule(delayMs)
    },
    flush,
    /** How many edits wait, across documents. */
    get size() {
      let count = 0
      for (const entry of pending.values()) count += entry.changes.length
      return count
    },
    dispose() {
      if (timer) clearTimeout(timer)
      timer = null
    }
  }
}

const queue = createCloudHistoryQueue({
  targetOf(binding) {
    const target = cloudShareTarget(binding)
    if (!target) return null
    return {
      append: (changes) => target.client.appendDocumentHistory(target.documentId, { changes })
    }
  },
  online: () => !IS_BROWSER || navigator.onLine
})

/** Sends what is waiting; what fails stays queued, as the editor stays usable offline. */
export function flushCloudHistory(): Promise<void> {
  return queue.flush()
}

/**
 * Shares an edit of a Cloud document with its server, which keeps it signed by the person signed
 * in there, so everyone's history lists who did what. Edits of other documents stay local.
 */
export function shareHistoryChange(
  binding: StorageDocumentBinding | null,
  change: HistoryChange
): void {
  if (!binding || !isCloudBinding(binding)) return
  queue.add(binding, change)
}

/** Shares every Cloud document's edits from here on; returns what stops it. */
export function shareCloudHistory(): () => void {
  const stop = onDesignHistoryRecorded((store, change) =>
    shareHistoryChange(store.getStorageBinding(), change)
  )
  const online = () => void queue.flush()
  if (IS_BROWSER) window.addEventListener('online', online)
  return () => {
    stop()
    if (IS_BROWSER) window.removeEventListener('online', online)
  }
}
