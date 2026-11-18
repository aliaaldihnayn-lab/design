import { computed, effectScope, ref, shallowRef, watch } from 'vue'

import type { DocumentHistoryChange, DocumentVersion } from '@lawha/cloud/contract'

import type { EditorStore } from '@/app/editor/session'

import { cloudRoomPermissions } from '../rooms/live'
import { listEditLog, listVersions, versionHistoryAccountId } from './actions'
import { isVersionHistoryOpen, versionHistoryOf, versionListRevision } from './history'
import { cloudVersionTimeline } from './sessions'

/** The most pages of edits one load reads before it stops, however far back they go. */
const EDIT_LOG_PAGES = 5

export type VersionList = ReturnType<typeof createVersionList>

/**
 * Each open history's list. Choosing a version remounts the workspace, and the list keeps its
 * filters, loaded pages, and scroll position across that.
 */
const lists = new Map<EditorStore, VersionList>()

function createVersionList(document: EditorStore) {
  const versions = shallowRef<DocumentVersion[]>([])
  const nextCursor = ref<string | null>(null)
  const loading = ref(false)
  const failed = ref(false)
  const onlyYours = ref(false)
  const showAutosaves = ref(true)
  const scrollTop = ref(0)
  const changes = shallowRef<DocumentHistoryChange[]>([])
  let generation = 0

  /**
   * The edits since the oldest version listed, newest first, a page at a time. An edit log the
   * server cannot give, as before the log existed, leaves the versions on their own.
   */
  async function loadEdits(current: number) {
    const oldest = versions.value.at(-1)?.createdAt
    const loaded: DocumentHistoryChange[] = []
    let cursor: string | undefined
    try {
      for (let page = 0; page < EDIT_LOG_PAGES; page++) {
        const next = await listEditLog(document, cursor)
        loaded.push(...next.changes)
        const last = next.changes.at(-1)
        if (!next.nextCursor || !last || (oldest && last.at < oldest)) break
        cursor = next.nextCursor
      }
    } catch (error) {
      console.warn('[Cloud] Loading the edit log failed:', error)
    }
    if (current === generation) changes.value = loaded
  }

  async function load(before?: string) {
    const current = ++generation
    loading.value = true
    failed.value = false
    try {
      const page = await listVersions(document, before)
      if (current !== generation) return
      versions.value = before ? [...versions.value, ...page.versions] : page.versions
      nextCursor.value = page.nextCursor
      await loadEdits(current)
    } catch (error) {
      if (current !== generation) return
      failed.value = true
      console.warn('[Cloud] Loading the version history failed:', error)
    } finally {
      if (current === generation) loading.value = false
    }
  }

  watch(
    () => versionListRevision(document),
    () => void load(),
    { immediate: true }
  )

  const accountId = computed(() => versionHistoryAccountId(document))
  const byId = computed(() => new Map(versions.value.map((version) => [version.id, version])))
  /** A restore reads as a named entry, as Figma lists "Restored version: …". */
  const isNamed = (version: DocumentVersion) =>
    version.kind === 'named' || version.restoredFromVersionId !== null
  const listed = computed(() =>
    versions.value.filter(
      (version) =>
        (showAutosaves.value || isNamed(version)) &&
        (!onlyYours.value || version.createdBy.id === accountId.value)
    )
  )
  const canEdit = computed(() => cloudRoomPermissions.value.get(document) !== 'view')
  /** The versions listed with each person's sessions of edits between them. */
  const timeline = computed(() =>
    cloudVersionTimeline(
      listed.value,
      changes.value.filter((change) => !onlyYours.value || change.author.id === accountId.value),
      { complete: nextCursor.value === null }
    )
  )

  return {
    document,
    versions: listed,
    timeline,
    nextCursor,
    loading,
    failed,
    onlyYours,
    showAutosaves,
    scrollTop,
    canEdit,
    isNamed,
    restoredFrom: (version: DocumentVersion) =>
      version.restoredFromVersionId ? byId.value.get(version.restoredFromVersionId) : undefined,
    loadOlder: () => (nextCursor.value ? load(nextCursor.value) : Promise.resolve()),
    reload: () => load()
  }
}

/**
 * The document's history as the panel lists it, newest first and a page at a time, with Figma's
 * filters: everyone's versions or only yours, and autosaves shown or hidden. It lasts until the
 * history closes.
 */
export function useVersionList(shown: EditorStore): VersionList {
  const document = versionHistoryOf(shown)?.store ?? shown
  const existing = lists.get(document)
  if (existing) return existing
  const scope = effectScope(true)
  const list = scope.run(() => {
    watch(
      () => isVersionHistoryOpen(document),
      (open) => {
        if (open) return
        lists.delete(document)
        scope.stop()
      },
      { flush: 'sync' }
    )
    return createVersionList(document)
  })
  if (!list) throw new Error('The version list could not be created')
  lists.set(document, list)
  return list
}
