import { describe, expect, test } from 'bun:test'

import { SceneGraph } from '@lawha/scene-graph'

import { createEditorStore } from '@/app/editor/session'
import { attachDesignHistory, designHistoryKey } from '@/app/history/design'
import { createMemoryHistoryPersistence } from '@/app/history/persistence'

const author = () => ({ id: 'ana', name: 'Ana', avatarUrl: null, color: null })

function setup(persistence = createMemoryHistoryPersistence()) {
  const store = createEditorStore(new SceneGraph())
  const session = attachDesignHistory(store, { persistence, author, idleMs: 60_000 })
  return { store, session, persistence }
}

describe('design tab history', () => {
  test('keeps the document as opened and records each edit', async () => {
    const { store, session, persistence } = setup()
    const card = store.graph.createNode('RECTANGLE', store.state.currentPageId, { name: 'Card' })
    store.recordEdit({ label: 'Move' }, () => store.graph.updateNode(card.id, { x: 10 }))
    await session.controller.persistNow()

    const history = session.controller.history.value
    expect(history.listVersions()).toHaveLength(1)
    expect(history.listChanges()[0]?.summary).toMatchObject({ action: 'move', names: ['Card'] })
    const key = designHistoryKey(store)
    if (!key) throw new Error('expected a key')
    expect(persistence.keys()).toEqual([key])
    await session.dispose()
  })

  test('saves a named version and survives a reload of the same document', async () => {
    const persistence = createMemoryHistoryPersistence()
    const { store, session } = setup(persistence)
    await session.saveNamed('Review', 'Before client call')
    const key = designHistoryKey(store)
    await session.dispose()

    const reopened = createEditorStore(new SceneGraph())
    // The same recovery identity stands for the same unsaved document after a reload.
    await reopened.adoptRecoverySnapshot(store.getRecoveryId())
    const again = attachDesignHistory(reopened, { persistence, author })
    await again.controller.refresh()
    expect(designHistoryKey(reopened)).toBe(key)
    const titles = again.controller.history.value.listVersions().map((version) => version.title)
    expect(titles).toContain('Review')
    await again.dispose()
  })
})
