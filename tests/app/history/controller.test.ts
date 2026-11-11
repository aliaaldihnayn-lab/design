import { describe, expect, test } from 'bun:test'

import { DocumentHistory } from '@lawha/core/history'

import { createHistoryController } from '@/app/history/controller'
import { createMemoryHistoryPersistence } from '@/app/history/persistence'

const author = { id: 'a', name: 'Ana', avatarUrl: null, color: null }
const move = { action: 'move' as const, count: 1, names: [], label: 'Move' }

describe('history controller', () => {
  test('writes the history under the document key and reads it back after a reload', async () => {
    const persistence = createMemoryHistoryPersistence()
    const first = createHistoryController({
      documentKind: 'design',
      resolveKey: () => 'path:/a.fig',
      persistence
    })
    first.history.value.recordChange({ author, summary: move })
    await first.persistNow()

    const second = createHistoryController({
      documentKind: 'design',
      resolveKey: () => 'path:/a.fig',
      persistence
    })
    await second.refresh()
    expect(second.history.value.listChanges()).toHaveLength(1)
  })

  test('carries history to the new key when the document is saved somewhere', async () => {
    const persistence = createMemoryHistoryPersistence()
    let key = 'recovery:1'
    const controller = createHistoryController({
      documentKind: 'design',
      resolveKey: () => key,
      persistence
    })
    controller.history.value.recordChange({ author, summary: move })
    await controller.persistNow()
    key = 'path:/saved.fig'
    controller.history.value.recordChange({ author, summary: move })
    await controller.persistNow()
    expect(persistence.keys()).toEqual(['path:/saved.fig'])
    const stored = await persistence.read('path:/saved.fig')
    expect(stored?.changes).toHaveLength(2)
  })

  test('merges what was kept under a key it moves to', async () => {
    const persistence = createMemoryHistoryPersistence()
    const kept = new DocumentHistory({ documentKind: 'design', now: () => 1 })
    kept.recordChange({ author, summary: { ...move, label: 'Earlier' } })
    await persistence.write('path:/a.fig', kept.toState())
    let loads = 0
    const controller = createHistoryController({
      documentKind: 'design',
      resolveKey: () => 'path:/a.fig',
      persistence,
      onLoaded: () => loads++
    })
    controller.history.value.recordChange({ author, summary: move })
    await controller.refresh()
    expect(controller.history.value.listChanges().map((change) => change.summary.label)).toEqual([
      'Earlier',
      'Move'
    ])
    expect(loads).toBe(1)
  })

  test('prunes to the size limit before writing, keeping named versions', async () => {
    const persistence = createMemoryHistoryPersistence()
    const controller = createHistoryController({
      documentKind: 'writer',
      resolveKey: () => 'k',
      persistence,
      maxStoredLength: 5000
    })
    const history = controller.history.value
    history.saveVersion({ author, records: [['a', 'n'.repeat(1000)]], title: 'Named' })
    for (let index = 0; index < 20; index++) {
      history.saveVersion({ author, records: [['a', String(index).repeat(1000)]] })
    }
    await controller.persistNow()
    expect(history.storedTextLength).toBeLessThanOrEqual(5000)
    expect(history.listVersions()[0]?.title).toBe('Named')
  })
})
