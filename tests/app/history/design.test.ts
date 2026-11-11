import { describe, expect, test } from 'bun:test'

import { SceneGraph } from '@lawha/scene-graph'

import { createEditorStore } from '@/app/editor/session'
import { createHistoryController } from '@/app/history/controller'
import { attachDesignHistory, designHistoryKey } from '@/app/history/design'
import { createMemoryHistoryPersistence } from '@/app/history/persistence'
import { createFileIdentityStore, createMemoryFileIdentityRows } from '@/app/storage/file-identity'

import { asDouble } from '#tests/helpers/doubles'

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
    const key = await designHistoryKey(store)
    if (!key) throw new Error('expected a key')
    expect(persistence.keys()).toEqual([key])
    await session.dispose()
  })

  test('saves a named version and survives a reload of the same document', async () => {
    const persistence = createMemoryHistoryPersistence()
    const { store, session } = setup(persistence)
    await session.saveNamed('Review', 'Before client call')
    const key = await designHistoryKey(store)
    await session.dispose()

    const reopened = createEditorStore(new SceneGraph())
    // The same recovery identity stands for the same unsaved document after a reload.
    await reopened.adoptRecoverySnapshot(store.getRecoveryId())
    const again = attachDesignHistory(reopened, { persistence, author })
    await again.controller.refresh()
    expect(await designHistoryKey(reopened)).toBe(key)
    const titles = again.controller.history.value.listVersions().map((version) => version.title)
    expect(titles).toContain('Review')
    await again.dispose()
  })

  test('keeps two browser files of the same name apart, and follows one through a new handle', async () => {
    const identities = createFileIdentityStore(createMemoryFileIdentityRows())
    const persistence = createMemoryHistoryPersistence()
    const open = (handle: FileSystemFileHandle) => {
      const source = {
        getStorageBinding: () => null,
        getDocumentFilePath: () => null,
        getSourceIdentity: () => ({ handle, path: null }),
        getRecoveryId: () => 'recovery'
      }
      return createHistoryController({
        documentKind: 'design',
        resolveKey: () => designHistoryKey(source, identities),
        persistence
      })
    }
    const original = { content: 'first', gone: false }
    const first = open(fileHandle('Untitled.fig', original))
    const second = open(fileHandle('Untitled.fig', { content: 'second' }))
    for (const [controller, title] of [
      [first, 'First'],
      [second, 'Second']
    ] as const) {
      await controller.refresh()
      controller.history.value.saveVersion({ author: author(), records: [], kind: 'named', title })
      await controller.persistNow()
    }
    expect(persistence.keys()).toHaveLength(2)
    expect(first.key).not.toBe(second.key)

    // Renamed on disk and dropped in again through a handle that does not compare equal.
    original.gone = true
    const again = open(fileHandle('Renamed.fig', { content: 'first' }))
    await again.refresh()
    expect(again.key).toBe(first.key)
    const titles = again.history.value.listVersions().map((version) => version.title)
    expect(titles).toContain('First')
    expect(titles).not.toContain('Second')
  })
})

/** A browser file handle over `file.content`, equal only to itself. */
function fileHandle(name: string, file: { content: string; gone?: boolean }): FileSystemFileHandle {
  const handle = {
    kind: 'file' as const,
    name,
    getFile: async () => {
      if (file.gone) throw new DOMException('Moved', 'NotFoundError')
      return new File([file.content], name)
    },
    isSameEntry: async (other: unknown) => other === handle
  }
  return asDouble<FileSystemFileHandle>(handle)
}
