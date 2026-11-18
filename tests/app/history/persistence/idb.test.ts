import 'fake-indexeddb/auto'
import { expect, test } from 'bun:test'

import { DocumentHistory } from '@lawha/core/history'

import { createIdbHistoryPersistence } from '@/app/history/persistence/idb'

const author = { id: 'a', name: 'Ana', avatarUrl: null, color: null }

test('keeps a history in IndexedDB across connections', async () => {
  const history = new DocumentHistory({ documentKind: 'design' })
  history.recordChange({ author, summary: { action: 'move', count: 1, names: [], label: 'Move' } })
  const version = history.saveVersion({ author, records: [['n:1', new Uint8Array([9])]] })

  await createIdbHistoryPersistence().write('path:/a.fig', history.toState())
  const stored = await createIdbHistoryPersistence().read('path:/a.fig')
  const reloaded = stored && DocumentHistory.fromState(stored)
  if (!reloaded || !version) throw new Error('expected a stored history')
  expect(reloaded.listChanges()).toEqual(history.listChanges())
  expect(reloaded.versionRecords(version.id)).toEqual([['n:1', new Uint8Array([9])]])

  await createIdbHistoryPersistence().remove('path:/a.fig')
  expect(await createIdbHistoryPersistence().read('path:/a.fig')).toBeNull()
})
