import { watch } from 'vue'

import {
  DEFAULT_AUTO_VERSION_EVERY,
  summarizeWriterChange,
  writerFromRecords,
  writerRecords,
  type HistoryAction,
  type HistoryAuthor,
  type HistoryVersion
} from '@lawha/core/history'
import type { WriterDocument } from '@lawha/core/writer'

import {
  replaceWriterDocument,
  writerAuthor,
  writerDocument,
  writerLoads,
  writerSource,
  type WriterSource
} from '@/app/writer/session'

import { localHistoryAuthor } from './author'
import { createHistoryController } from './controller'
import { HISTORY_IDLE_CHECKPOINT_MS } from './design'
import { getHistoryPersistence, type HistoryPersistence } from './persistence'

/** Typing pauses this long before what was typed is recorded as one edit. */
export const WRITER_CHANGE_DELAY_MS = 1500

/** The key a document's history is kept under, from where it was opened or saved. */
export function writerHistoryKey(source: WriterSource | null): string | null {
  if (!source) return null
  if (source.kind === 'google') return `writer:google:${source.documentId}`
  if (source.path) return `writer:path:${source.path}`
  if (source.handle) return `writer:file:${source.handle.name}`
  return null
}

export interface WriterHistoryOptions {
  persistence?: HistoryPersistence
  author?: () => HistoryAuthor
  changeDelayMs?: number
  idleMs?: number
}

/** Comments and tracked changes are signed with the writer's name; history follows it. */
function writerHistoryAuthor(): HistoryAuthor {
  const name = writerAuthor.value.trim()
  return name ? { id: `local:${name}`, name, avatarUrl: null, color: null } : localHistoryAuthor()
}

/**
 * Records the document editor's history: each pause in editing becomes an edit described by the
 * paragraphs it touched, versions are kept on opening, every fifty edits, after a longer pause,
 * and when saved by name, all on this device under the document's file or Google Doc. A
 * document not saved anywhere yet keeps its history in memory until it is.
 */
export function createWriterHistory(options: WriterHistoryOptions = {}) {
  const author = options.author ?? writerHistoryAuthor
  const delay = options.changeDelayMs ?? WRITER_CHANGE_DELAY_MS
  const idleMs = options.idleMs ?? HISTORY_IDLE_CHECKPOINT_MS
  const controller = createHistoryController({
    documentKind: 'writer',
    resolveKey: () => writerHistoryKey(writerSource.value),
    persistence: options.persistence ?? getHistoryPersistence()
  })
  let recorded: WriterDocument = writerDocument.value
  let pending: ReturnType<typeof setTimeout> | null = null
  let idle: ReturnType<typeof setTimeout> | null = null
  let quiet = 0

  const history = () => controller.history.value

  function checkpoint(): HistoryVersion | null {
    return history().saveVersion({ author: author(), records: writerRecords(writerDocument.value) })
  }

  /** Records what changed since the last edit recorded, if anything did. */
  function flush(label = 'Edit', action?: HistoryAction) {
    if (pending) clearTimeout(pending)
    pending = null
    const current = writerDocument.value
    if (current === recorded) return
    const summary = summarizeWriterChange(recorded, current, label)
    recorded = current
    if (summary.count === 0 && summary.action === 'restyle' && label === 'Edit') {
      // Nothing in the body changed; page setup or comments did.
      summary.action = 'edit'
    }
    if (action) summary.action = action
    history().recordChange({ author: author(), summary, coalesce: summary.action === 'edit-text' })
    if (history().changesSinceLatestVersion().length >= DEFAULT_AUTO_VERSION_EVERY) checkpoint()
    controller.schedulePersist()
    if (idle) clearTimeout(idle)
    idle = setTimeout(() => {
      if (checkpoint()) controller.schedulePersist()
    }, idleMs)
  }

  function startDocument() {
    if (pending) clearTimeout(pending)
    pending = null
    controller.reset()
    recorded = writerDocument.value
    checkpoint()
    void controller.refresh()
  }

  const stopDocument = watch(writerDocument, () => {
    if (quiet > 0) return
    if (pending) clearTimeout(pending)
    pending = setTimeout(() => flush(), delay)
  })
  const stopLoads = watch(writerLoads, startDocument)
  // Saving to a file or a Google Doc gives the history a place to be kept.
  const stopSource = watch(writerSource, () => void controller.persistNow())
  startDocument()

  /** Runs `change` as one edit of its own with `label`, not folded into typing. */
  function recordOwn(label: string, action: HistoryAction, change: () => void) {
    flush()
    quiet++
    try {
      change()
    } finally {
      quiet--
    }
    flush(label, action)
  }

  return {
    controller,
    flush,
    checkpoint,
    async saveNamed(title: string, description = '') {
      flush()
      await controller.refresh()
      history().saveVersion({
        author: author(),
        records: writerRecords(writerDocument.value),
        kind: 'named',
        title,
        description
      })
      await controller.persistNow()
    },
    versionDocument(versionId: string): WriterDocument {
      return writerFromRecords(history().versionRecords(versionId))
    },
    /**
     * Brings a version back, losing nothing: the document as it is now is kept as a version
     * first, the restore is an edit of its own, and a version marked as restored holds the result.
     */
    async restore(versionId: string): Promise<void> {
      const version = history().getVersion(versionId)
      if (!version) throw new Error(`No version ${versionId}`)
      const target = writerFromRecords(history().versionRecords(versionId))
      flush()
      checkpoint()
      recordOwn('Restore version', 'restore', () => replaceWriterDocument(target))
      history().saveVersion({
        author: author(),
        records: writerRecords(writerDocument.value),
        kind: 'restore',
        restoredFromId: version.id
      })
      await controller.persistNow()
    },
    async rename(versionId: string, info: { title: string | null; description?: string }) {
      history().renameVersion(versionId, info)
      await controller.persistNow()
    },
    dispose() {
      if (pending) clearTimeout(pending)
      if (idle) clearTimeout(idle)
      stopDocument()
      stopLoads()
      stopSource()
      void controller.dispose()
    }
  }
}

export type WriterHistory = ReturnType<typeof createWriterHistory>

let shared: WriterHistory | null = null

/** The document editor's one history, started the first time it is asked for. */
export function useWriterHistory(): WriterHistory {
  shared ??= createWriterHistory()
  return shared
}
