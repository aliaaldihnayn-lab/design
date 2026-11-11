import { shallowRef, triggerRef, type ShallowRef } from 'vue'

import {
  DEFAULT_HISTORY_RETENTION,
  DocumentHistory,
  type HistoryDocumentKind,
  type HistoryRetention
} from '@lawha/core/history'

import type { HistoryPersistence } from './persistence'

/** Past this much stored record text, older automatic versions go first. */
export const HISTORY_MAX_STORED_LENGTH = 48 * 1024 * 1024
const PERSIST_DELAY_MS = 1500

export interface HistoryControllerOptions {
  documentKind: HistoryDocumentKind
  /**
   * The key the document's history is kept under now; it changes when the document is saved
   * somewhere. It may take a moment to find, as a browser file's identity does.
   */
  resolveKey: () => string | null | Promise<string | null>
  persistence: HistoryPersistence
  retention?: HistoryRetention
  maxStoredLength?: number
  /** Called after history kept under the document's key joins this one. */
  onLoaded?: (history: DocumentHistory) => void
}

/**
 * Keeps one document's history in step with this device's storage: loads what was kept under
 * the document's key, follows the key when the document is saved to a new place, carrying the
 * history along, and writes changes back after a short delay, pruned to the retention limits.
 */
export function createHistoryController(options: HistoryControllerOptions) {
  const retention = options.retention ?? DEFAULT_HISTORY_RETENTION
  const maxStored = options.maxStoredLength ?? HISTORY_MAX_STORED_LENGTH
  const history: ShallowRef<DocumentHistory> = shallowRef(
    new DocumentHistory({ documentKind: options.documentKind })
  )
  let key: string | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let writing: Promise<void> = Promise.resolve()
  /** Refreshes run one after another, since finding the key can wait. */
  let refreshing: Promise<void> = Promise.resolve()
  let disposed = false

  const watchHistory = (target: DocumentHistory) => target.subscribe(() => triggerRef(history))
  let stopWatching = watchHistory(history.value)

  /** Follows the document's key: loads its history the first time, moves it when it changes. */
  function refresh(): Promise<void> {
    const run = refreshing.then(follow)
    refreshing = run.catch(() => undefined)
    return run
  }

  async function follow(): Promise<void> {
    const next = await options.resolveKey()
    if (!next || next === key) return
    const previous = key
    key = next
    const stored = await options.persistence.read(next)
    if (stored && stored.documentKind === options.documentKind && history.value.absorb(stored)) {
      options.onLoaded?.(history.value)
    }
    if (previous && previous !== next) {
      await write()
      await options.persistence.remove(previous)
    }
    triggerRef(history)
  }

  /** Prunes to the retention limits, then further while the history is too large to keep. */
  function prune() {
    const current = history.value
    current.prune(retention)
    let autos = retention.maxAutoVersions
    while (current.storedTextLength > maxStored && autos > 1) {
      autos = Math.floor(autos / 2)
      current.prune({ ...retention, maxAutoVersions: autos })
    }
  }

  async function persistNow(): Promise<void> {
    if (timer) clearTimeout(timer)
    timer = null
    await refresh()
    await write()
  }

  async function write(): Promise<void> {
    if (!key || disposed) return
    const target = key
    prune()
    const state = history.value.toState()
    writing = writing
      .then(() => options.persistence.write(target, state))
      .catch((error: unknown) =>
        console.warn('[History] Saving the version history failed:', error)
      )
    await writing
  }

  function schedulePersist() {
    if (disposed) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => void persistNow(), PERSIST_DELAY_MS)
  }

  /** Starts over for another document in the same place, as when a tab opens a new file. */
  function reset() {
    stopWatching()
    history.value = new DocumentHistory({ documentKind: options.documentKind })
    stopWatching = watchHistory(history.value)
    key = null
  }

  return {
    history,
    get key() {
      return key
    },
    refresh,
    persistNow,
    schedulePersist,
    reset,
    async dispose() {
      if (timer) await persistNow()
      disposed = true
      stopWatching()
    }
  }
}

export type HistoryController = ReturnType<typeof createHistoryController>
