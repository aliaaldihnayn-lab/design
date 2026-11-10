import { expect, test } from 'bun:test'

import { DocumentHistory } from '@lawha/core/history'

import { historyTimeline } from '@/app/history/timeline'

const ana = { id: 'ana', name: 'Ana', avatarUrl: null, color: null }
const move = { action: 'move' as const, count: 1, names: ['Card'], label: 'Move' }
const DAY = 24 * 60 * 60 * 1000

test('lists days newest first, with sessions split at the versions inside them', () => {
  let now = Date.UTC(2026, 10, 10, 9)
  const history = new DocumentHistory({ documentKind: 'design', now: () => now })
  history.recordChange({ author: ana, summary: move })
  now += 60_000
  history.saveVersion({ author: ana, records: [['a', 1]], title: 'Draft' })
  now += 60_000
  history.recordChange({ author: ana, summary: move })
  now += DAY
  history.recordChange({ author: ana, summary: move })

  const days = historyTimeline(history, 'UTC')
  expect(days.map((day) => day.day.toString())).toEqual(['2026-11-11', '2026-11-10'])
  expect(days[0]?.entries.map((entry) => entry.kind)).toEqual(['session'])
  expect(days[1]?.entries.map((entry) => entry.kind)).toEqual(['session', 'version', 'session'])
})
