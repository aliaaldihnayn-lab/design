import type { DocumentHistoryChangeInput } from '@lawha/cloud/contract'
import { DOCUMENT_HISTORY_BATCH_LIMIT } from '@lawha/cloud/contract'
import type { HistoryChange } from '@lawha/core/history'

import { onDesignHistoryRecorded } from '@/app/history/design'
import type { StorageDocumentBinding } from '@/app/integrations/storage/types'

import { isCloudBinding } from '../documents/status'
import { cloudShareTarget } from '../sharing/document'

/** Edits wait this long for others before they are sent together. */
export const CLOUD_HISTORY_SEND_DELAY_MS = 3000

type Pending = { binding: StorageDocumentBinding; changes: DocumentHistoryChangeInput[] }

const pending = new Map<string, Pending>()
let timer: ReturnType<typeof setTimeout> | null = null

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

/** Sends what is waiting; what fails waits for the next edit, as the editor stays usable offline. */
export async function flushCloudHistory(): Promise<void> {
  if (timer) clearTimeout(timer)
  timer = null
  for (const [key, entry] of pending) {
    const target = cloudShareTarget(entry.binding)
    if (!target) continue
    const batch = entry.changes.slice(0, DOCUMENT_HISTORY_BATCH_LIMIT)
    try {
      await target.client.appendDocumentHistory(target.documentId, { changes: batch })
      const rest = entry.changes.slice(batch.length)
      if (rest.length > 0) pending.set(key, { ...entry, changes: rest })
      else pending.delete(key)
    } catch (error) {
      console.warn('[Cloud] Sending the document history failed:', error)
    }
  }
  if (pending.size > 0 && [...pending.values()].some((entry) => cloudShareTarget(entry.binding))) {
    schedule()
  }
}

function schedule() {
  if (timer) return
  timer = setTimeout(() => void flushCloudHistory(), CLOUD_HISTORY_SEND_DELAY_MS)
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
  const key = keyOf(binding)
  const entry = pending.get(key) ?? { binding, changes: [] }
  const index = entry.changes.findIndex((existing) => existing.id === change.id)
  // A change folded into the one before it is sent as it ends up.
  if (index === -1) entry.changes.push(inputOf(change))
  else entry.changes[index] = inputOf(change)
  pending.set(key, entry)
  schedule()
}

/** Shares every Cloud document's edits from here on; returns what stops it. */
export function shareCloudHistory(): () => void {
  return onDesignHistoryRecorded((store, change) =>
    shareHistoryChange(store.getStorageBinding(), change)
  )
}
