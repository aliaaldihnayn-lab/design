import { afterEach, describe, expect, test } from 'bun:test'

import { SceneGraph } from '@lawha/scene-graph'

import { createEditorStore, type EditorStore } from '@/app/editor/session'
import { attachDesignHistory } from '@/app/history/design'
import {
  closeLocalHistory,
  compareLocalVersion,
  isLocalHistoryOpen,
  localHistoryOf,
  openLocalHistory,
  previewLocalVersion,
  restoreLocalVersion,
  shownLocalStore
} from '@/app/history/panel'
import { createMemoryHistoryPersistence } from '@/app/history/persistence'

const opened: EditorStore[] = []
afterEach(() => {
  for (const store of opened.splice(0)) closeLocalHistory(store)
})

async function setup() {
  const store = createEditorStore(new SceneGraph())
  const session = attachDesignHistory(store, {
    persistence: createMemoryHistoryPersistence(),
    author: () => ({ id: 'ana', name: 'Ana', avatarUrl: null, color: null })
  })
  const pageId = store.state.currentPageId
  const card = store.graph.createNode('RECTANGLE', pageId, { name: 'Card', x: 0 })
  await session.saveNamed('Start')
  const start = session.controller.history.value.latestVersion
  if (!start) throw new Error('expected a version')
  store.recordEdit({ label: 'Move' }, () => store.graph.updateNode(card.id, { x: 50 }))
  const added = store.recordEdit({ label: 'Rectangle' }, () =>
    store.graph.createNode('RECTANGLE', pageId, { name: 'Badge' })
  )
  opened.push(store)
  return { store, session, card, added, start }
}

describe('local version history panel', () => {
  test('opens read-only and previews a version in its own read-only editor', async () => {
    const { store, card, start } = await setup()
    await openLocalHistory(store)
    expect(isLocalHistoryOpen(store)).toBe(true)
    expect(store.state.hostRestrictions.readOnly).toBe(true)

    void previewLocalVersion(store, start.id)
    const preview = shownLocalStore(store)
    expect(preview).not.toBe(store)
    expect(preview.graph.getNode(card.id)?.x).toBe(0)
    expect(preview.state.hostRestrictions.readOnly).toBe(true)
    // The document itself is untouched.
    expect(store.graph.getNode(card.id)?.x).toBe(50)

    closeLocalHistory(store)
    expect(store.state.hostRestrictions.readOnly).toBe(false)
    expect(shownLocalStore(store)).toBe(store)
  })

  test('compares a version with the document and selects what changed', async () => {
    const { store, card, added, start } = await setup()
    await openLocalHistory(store)
    const comparison = compareLocalVersion(store, start.id)
    expect(comparison?.layers.map((layer) => [layer.name, layer.change])).toEqual([
      ['Card', 'changed'],
      ['Badge', 'added']
    ])
    expect(new Set(store.state.selectedIds)).toEqual(new Set([card.id, added.id]))
    expect(localHistoryOf(store)?.comparison?.versionId).toBe(start.id)
  })

  test('restores a version as an edit of its own, which undo takes back', async () => {
    const { store, session, card, added, start } = await setup()
    await openLocalHistory(store)
    await restoreLocalVersion(store, start.id)
    expect(isLocalHistoryOpen(store)).toBe(false)
    expect(store.graph.getNode(card.id)?.x).toBe(0)
    expect(store.graph.getNode(added.id)).toBeUndefined()
    const history = session.controller.history.value
    expect(history.latestChange?.summary.action).toBe('restore')
    expect(history.latestVersion?.kind).toBe('restore')
    store.undo.undo()
    expect(store.graph.getNode(card.id)?.x).toBe(50)
  })
})
