import { shallowRef } from 'vue'

import {
  designDiffFromKeys,
  designRecordNodeId,
  designRecords,
  graphFromDesignRecords,
  restoreDesignVersion,
  type DesignVersionDiff,
  type HistoryVersion
} from '@lawha/core/history'

import { createEditorStore, type EditorStore } from '@/app/editor/session'
import { createTab } from '@/app/tabs'

import { localHistoryAuthor } from './author'
import { attachDesignHistory, designHistoryOf } from './design'
import { openHistoryVersionDialog } from './dialog'

/** A layer the comparison found, with the name it has where it still exists. */
export type ComparedLayer = { id: string; name: string; change: 'added' | 'removed' | 'changed' }

export type LocalVersionComparison = {
  versionId: string
  diff: DesignVersionDiff
  layers: ComparedLayer[]
}

/**
 * A design tab's open version history. As in Figma the document is read-only while it is open;
 * a previewed version gets a read-only editor of its own in the document's place.
 */
export type LocalHistoryState = {
  store: EditorStore
  wasReadOnly: boolean
  preview: { versionId: string; store: EditorStore } | null
  comparison: LocalVersionComparison | null
}

const states = shallowRef<ReadonlyMap<EditorStore, LocalHistoryState>>(new Map())

function update(store: EditorStore, next: LocalHistoryState | null) {
  const map = new Map(states.value)
  if (next) map.set(store, next)
  else map.delete(store)
  states.value = map
}

/** The open history that `store` is the document or the previewed version of. */
export function localHistoryOf(store: EditorStore): LocalHistoryState | undefined {
  const own = states.value.get(store)
  if (own) return own
  for (const state of states.value.values()) if (state.preview?.store === store) return state
  return undefined
}

export function isLocalHistoryOpen(store: EditorStore): boolean {
  return localHistoryOf(store) !== undefined
}

/** What the tab of `store` shows: the previewed version while there is one. */
export function shownLocalStore(store: EditorStore): EditorStore {
  return states.value.get(store)?.preview?.store ?? store
}

/** A key that changes whenever the tab shows another version or the document again. */
export function localPreviewKey(store: EditorStore): string {
  const preview = states.value.get(store)?.preview
  return preview ? `:history:${preview.versionId}` : ''
}

function documentOf(store: EditorStore): EditorStore {
  return localHistoryOf(store)?.store ?? store
}

function sessionOf(store: EditorStore) {
  return attachDesignHistory(documentOf(store))
}

function endPreview(state: LocalHistoryState) {
  state.preview?.store.preparationController.dispose()
  state.preview?.store.dispose()
}

export async function openLocalHistory(store: EditorStore): Promise<void> {
  if (states.value.has(store)) return
  const session = sessionOf(store)
  await session.controller.refresh()
  // What is on screen now is a version to come back to.
  if (session.recorder.checkpoint()) session.controller.schedulePersist()
  update(store, {
    store,
    wasReadOnly: store.state.hostRestrictions.readOnly,
    preview: null,
    comparison: null
  })
  store.setReadOnly(true)
}

export function closeLocalHistory(store: EditorStore): void {
  const state = localHistoryOf(store)
  if (!state) return
  endPreview(state)
  update(state.store, null)
  state.store.clearSelection()
  state.store.setReadOnly(state.wasReadOnly)
}

export function showCurrentLocalVersion(store: EditorStore): void {
  const state = localHistoryOf(store)
  if (!state) return
  endPreview(state)
  update(state.store, { ...state, preview: null })
}

function versionGraph(store: EditorStore, versionId: string) {
  const history = sessionOf(store).controller.history.value
  return graphFromDesignRecords(history.versionRecords(versionId))
}

/** Shows a version read-only in the document's place, on the same page and view. */
export async function previewLocalVersion(store: EditorStore, versionId: string): Promise<void> {
  const state = localHistoryOf(store)
  if (!state) return
  const preview = createEditorStore(versionGraph(store, versionId))
  preview.state.documentName = state.store.state.documentName
  preview.setReadOnly(true)
  endPreview(state)
  update(state.store, { ...state, preview: { versionId, store: preview } })
  const { currentPageId, panX, panY, zoom } = state.store.state
  if (!preview.graph.getNode(currentPageId)) return
  await preview.canvasReady
  if (preview.state.currentPageId !== currentPageId) await preview.switchPage(currentPageId)
  Object.assign(preview.state, { panX, panY, zoom })
  preview.requestRepaint()
}

/**
 * Compares a version with the document as it is now and selects the layers that differ on the
 * current page, so the canvas highlights them; removed layers are listed by their old names.
 */
export function compareLocalVersion(
  store: EditorStore,
  versionId: string
): LocalVersionComparison | null {
  const state = localHistoryOf(store)
  if (!state) return null
  showCurrentLocalVersion(store)
  const document = state.store
  const history = sessionOf(document).controller.history.value
  const diff = designDiffFromKeys(history.diffWithCurrent(versionId, designRecords(document.graph)))
  const old = new Map(
    history.versionRecords(versionId).flatMap(([key, value]): [string, string][] => {
      const id = designRecordNodeId(key)
      const name = typeof value === 'object' && value && 'name' in value ? value.name : null
      return id && typeof name === 'string' ? [[id, name]] : []
    })
  )
  const isLayer = (id: string) => {
    const node = document.graph.getNode(id)
    return node ? node.type !== 'CANVAS' && node.id !== document.graph.rootId : old.has(id)
  }
  const layers: ComparedLayer[] = [
    ...diff.changed.map((id) => ({ id, change: 'changed' as const })),
    ...diff.added.map((id) => ({ id, change: 'added' as const })),
    ...diff.removed.map((id) => ({ id, change: 'removed' as const }))
  ]
    .filter(({ id }) => isLayer(id))
    .map((layer) => ({
      ...layer,
      name: document.graph.getNode(layer.id)?.name ?? old.get(layer.id) ?? ''
    }))
  const comparison = { versionId, diff, layers }
  const onPage = layers
    .filter((layer) => layer.change !== 'removed')
    .map((layer) => layer.id)
    .filter((id) => document.graph.getNode(id) && isOnPage(document, id))
  document.select(onPage)
  update(document, { ...state, preview: null, comparison })
  return comparison
}

function isOnPage(store: EditorStore, id: string): boolean {
  const pageId = store.state.currentPageId
  return store.graph.closest(id, (node) => node.id === pageId) !== undefined
}

export function endLocalComparison(store: EditorStore): void {
  const state = localHistoryOf(store)
  if (!state) return
  state.store.clearSelection()
  update(state.store, { ...state, comparison: null })
}

/**
 * Restores a version: the document as it is now is kept as a version first, the restore is one
 * undoable edit recorded in the history, and the history closes on the restored document.
 */
export async function restoreLocalVersion(store: EditorStore, versionId: string): Promise<void> {
  const state = localHistoryOf(store)
  if (!state) return
  const document = state.store
  const session = sessionOf(document)
  closeLocalHistory(document)
  const wasReadOnly = document.state.hostRestrictions.readOnly
  if (wasReadOnly) throw new Error('The document is read-only')
  restoreDesignVersion({
    history: session.controller.history.value,
    host: document,
    versionId,
    author: localHistoryAuthor()
  })
  await session.controller.persistNow()
}

/** Opens a version as a new document in a tab of its own, its history starting there. */
export function duplicateLocalVersion(
  store: EditorStore,
  versionId: string,
  name: string
): EditorStore {
  const graph = versionGraph(store, versionId)
  const tab = createTab(undefined, graph)
  tab.store.state.documentName = name
  return tab.store
}

/** Names a version or changes its name and description. */
export async function renameLocalVersion(
  store: EditorStore,
  versionId: string,
  info: { title: string | null; description?: string }
): Promise<void> {
  const session = sessionOf(store)
  session.controller.history.value.renameVersion(versionId, info)
  await session.controller.persistNow()
}

/** Saves the document as it is now as a named version. */
export async function saveLocalVersion(
  store: EditorStore,
  title: string,
  description = ''
): Promise<void> {
  await sessionOf(store).saveNamed(title, description)
}

/** Opens the version info dialog to save the document as a version, or to name `version`. */
export function openLocalVersionDialog(store: EditorStore, version: HistoryVersion | null = null) {
  const document = documentOf(store)
  openHistoryVersionDialog({
    version,
    save: ({ title, description }) =>
      version
        ? renameLocalVersion(document, version.id, { title, description })
        : saveLocalVersion(document, title, description)
  })
}

export function localHistorySession(store: EditorStore) {
  return designHistoryOf(documentOf(store))
}
