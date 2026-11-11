import {
  createDesignHistoryRecorder,
  designRecords,
  diffManifests,
  restoreDesignVersion,
  type DesignHistoryRecorder,
  type DocumentHistory,
  type HistoryAuthor,
  type HistoryChange
} from '@lawha/core/history'

import { getActiveEditorStoreOrNull } from '@/app/editor/active-store'
import type { EditorStore } from '@/app/editor/session'
import { browserFileIdentities, type FileIdentityStore } from '@/app/storage/file-identity'

import { localHistoryAuthor } from './author'
import { createHistoryController, type HistoryController } from './controller'
import { getHistoryPersistence, type HistoryPersistence } from './persistence'
import { provideHistoryToTools } from './tools'

/** A pause in editing this long keeps an automatic version, as Google Docs does. */
export const HISTORY_IDLE_CHECKPOINT_MS = 2 * 60 * 1000

/**
 * The key a design document's history is kept under, from where it is stored. A file the browser
 * opened is known by its identity on this device, not its name, so two files of the same name keep
 * their own histories and a renamed or dropped-in file keeps its own.
 */
export async function designHistoryKey(
  store: Pick<
    EditorStore,
    'getStorageBinding' | 'getDocumentFilePath' | 'getSourceIdentity' | 'getRecoveryId'
  >,
  identities: FileIdentityStore = browserFileIdentities()
): Promise<string | null> {
  const binding = store.getStorageBinding()
  if (binding) {
    return `storage:${binding.providerId}:${binding.profileId ?? ''}:${binding.documentId}`
  }
  const path = store.getDocumentFilePath()
  if (path) return `path:${path}`
  const handle = store.getSourceIdentity().handle
  if (handle) {
    try {
      return `browser-file:${await identities.resolve(handle)}`
    } catch (error) {
      console.warn('[History] Could not identify the opened file:', error)
      return `file:${handle.name}`
    }
  }
  return `recovery:${store.getRecoveryId()}`
}

export interface DesignHistorySession {
  store: EditorStore
  controller: HistoryController
  readonly recorder: DesignHistoryRecorder
  /** Keeps a named version now, as Save version. */
  saveNamed(title: string, description?: string): Promise<void>
  dispose(): Promise<void>
}

const sessions = new WeakMap<EditorStore, DesignHistorySession>()

export type DesignHistoryListener = (store: EditorStore, change: HistoryChange) => void
const recordedListeners = new Set<DesignHistoryListener>()

/**
 * Listens for every edit any design tab records, as Cloud does to share the edits of its
 * documents with their server. Returns what stops listening.
 */
export function onDesignHistoryRecorded(listener: DesignHistoryListener): () => void {
  recordedListeners.add(listener)
  return () => recordedListeners.delete(listener)
}

export interface AttachDesignHistoryOptions {
  persistence?: HistoryPersistence
  author?: () => HistoryAuthor
  idleMs?: number
  /** Where browser files' identities are kept; IndexedDB by default. */
  fileIdentities?: FileIdentityStore
}

/**
 * Records a design tab's history for as long as the tab lives: each edit as it is made, an
 * automatic version of the document as it was opened, after every fifty edits, and after a pause,
 * all kept on this device under the document's key.
 */
export function attachDesignHistory(
  store: EditorStore,
  options: AttachDesignHistoryOptions = {}
): DesignHistorySession {
  const existing = sessions.get(store)
  if (existing) return existing
  const author = options.author ?? localHistoryAuthor
  const idleMs = options.idleMs ?? HISTORY_IDLE_CHECKPOINT_MS
  let openingVersionId: string | null = null

  const controller = createHistoryController({
    documentKind: 'design',
    resolveKey: () => designHistoryKey(store, options.fileIdentities),
    persistence: options.persistence ?? getHistoryPersistence(),
    onLoaded: (history) => dropDuplicateOpening(history)
  })

  /** The version kept on opening is dropped when history kept before already ends with it. */
  function dropDuplicateOpening(history: DocumentHistory) {
    const versions = history.listVersions()
    const index = versions.findIndex((version) => version.id === openingVersionId)
    const previous = versions[index - 1]
    if (index < 1 || !openingVersionId) return
    const before = history.versionManifest(previous.id)
    const opened = history.versionManifest(openingVersionId)
    if (!before || !opened) return
    const diff = diffManifests(before, opened)
    if (diff.added.length + diff.removed.length + diff.changed.length === 0) {
      history.deleteVersion(openingVersionId)
    }
  }

  let idle: ReturnType<typeof setTimeout> | null = null
  const startRecorder = () =>
    createDesignHistoryRecorder({
      source: store,
      history: controller.history.value,
      author,
      onRecorded: (change) => {
        controller.schedulePersist()
        for (const listener of recordedListeners) listener(store, change)
        if (idle) clearTimeout(idle)
        idle = setTimeout(() => {
          if (recorder.checkpoint()) controller.schedulePersist()
        }, idleMs)
      }
    })
  let recorder = startRecorder()
  openingVersionId = recorder.checkpoint()?.id ?? null
  // The document's source is set once it is read; its history loads once it is known.
  queueMicrotask(() => void controller.refresh())

  const stopReplaced = store.onEditorEvent('graph:replaced', () => {
    recorder.dispose()
    controller.reset()
    recorder = startRecorder()
    openingVersionId = recorder.checkpoint()?.id ?? null
    queueMicrotask(() => void controller.refresh())
  })

  const session: DesignHistorySession = {
    store,
    controller,
    get recorder() {
      return recorder
    },
    async saveNamed(title, description = '') {
      await controller.refresh()
      recorder.saveNamed(title, description)
      await controller.persistNow()
    },
    async dispose() {
      if (idle) clearTimeout(idle)
      stopReplaced()
      recorder.dispose()
      sessions.delete(store)
      await controller.dispose()
    }
  }
  sessions.set(store, session)
  provideHistoryToTools('design', activeDesignTarget)
  return session
}

/**
 * The active tab's design history as the AI tools use it. A tool's restore runs inside the
 * edit the tool call records, so it joins that step rather than adding one of its own.
 */
function activeDesignTarget() {
  const store = getActiveEditorStoreOrNull()
  const session = store && sessions.get(store)
  if (!store || !session) return null
  const history = session.controller.history.value
  return {
    history,
    currentRecords: () => designRecords(store.graph),
    async save(title: string, description: string) {
      await session.saveNamed(title, description)
      return session.controller.history.value.latestVersion ?? null
    },
    async restore(versionId: string) {
      const recording = store.undo.isRecording
      const version = restoreDesignVersion({
        history: session.controller.history.value,
        host: recording
          ? { ...store, graph: store.graph, recordEdit: (_options, run) => run() }
          : store,
        versionId,
        author: localHistoryAuthor()
      })
      await session.controller.persistNow()
      return version
    }
  }
}

export function designHistoryOf(store: EditorStore): DesignHistorySession | undefined {
  return sessions.get(store)
}
