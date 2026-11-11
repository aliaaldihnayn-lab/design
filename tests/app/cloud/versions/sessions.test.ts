import { describe, expect, test } from 'bun:test'

import type { DocumentHistoryChange, DocumentVersion } from '@lawha/cloud/contract'

import { cloudVersionTimeline } from '@/app/cloud/versions/sessions'

const at = (minute: number) => new Date(Date.UTC(2026, 10, 11, 9, minute)).toISOString()

function version(id: string, minute: number): DocumentVersion {
  return {
    id,
    revisionId: id,
    kind: 'auto',
    name: null,
    description: null,
    createdAt: at(minute),
    createdBy: { id: 'ana', name: 'Ana' },
    restoredFromVersionId: null,
    current: false
  }
}

function change(
  id: string,
  minute: number,
  author = 'ana',
  sessionId = 's1'
): DocumentHistoryChange {
  return {
    id,
    at: at(minute),
    sessionId,
    summary: { action: 'move', count: 1, names: ['Card'], label: 'Move' },
    author: { id: author, name: author }
  }
}

const shape = (entries: ReturnType<typeof cloudVersionTimeline>) =>
  entries.map((entry) =>
    entry.kind === 'version'
      ? `v:${entry.version.id}`
      : `s:${entry.changes.map((c) => c.id).join(',')}`
  )

describe('Cloud version timeline', () => {
  test('lists each sitting of edits between the versions it falls between, newest first', () => {
    const entries = cloudVersionTimeline(
      [version('v2', 30), version('v1', 10)],
      [change('c4', 40), change('c3', 25), change('c2', 20), change('c1', 15)]
    )
    expect(shape(entries)).toEqual(['s:c4', 'v:v2', 's:c1,c2,c3', 'v:v1'])
  })

  test('splits a session at a version inside it and keeps people apart', () => {
    const entries = cloudVersionTimeline(
      [version('v1', 20)],
      [change('a1', 10), change('a2', 25), change('b1', 26, 'ben', 's2')],
      { complete: true }
    )
    expect(shape(entries)).toEqual(['s:b1', 's:a2', 'v:v1', 's:a1'])
  })

  test('holds back edits older than the versions listed until the history is complete', () => {
    const versions = [version('v1', 20)]
    const changes = [change('late', 30), change('early', 5)]
    expect(shape(cloudVersionTimeline(versions, changes))).toEqual(['s:late', 'v:v1'])
    expect(shape(cloudVersionTimeline(versions, changes, { complete: true }))).toEqual([
      's:late',
      'v:v1',
      's:early'
    ])
  })
})
