import { describe, expect, test } from 'bun:test'

import {
  decodeHistoryValue,
  DocumentHistory,
  encodeHistoryValue,
  type HistoryAuthor,
  type HistoryChangeSummary
} from '@lawha/core/history'

const ana: HistoryAuthor = { id: 'ana', name: 'Ana', avatarUrl: null, color: '#ff0000' }
const omar: HistoryAuthor = { id: 'omar', name: 'Omar', avatarUrl: null, color: null }
const summary = (label: string): HistoryChangeSummary => ({
  action: 'move',
  count: 1,
  names: ['Card'],
  label
})

function clock(start = 1_700_000_000_000) {
  let now = start
  return { now: () => now, advance: (ms: number) => (now += ms) }
}

describe('encoding', () => {
  test('round-trips bytes, maps, sets, undefined, and non-finite numbers', () => {
    const value = {
      bytes: new Uint8Array([1, 2, 255]),
      map: new Map([['a', 1]]),
      set: new Set(['x']),
      missing: undefined,
      nan: Number.NaN,
      inf: Number.NEGATIVE_INFINITY,
      floats: new Float32Array([0.5])
    }
    const decoded = decodeHistoryValue(encodeHistoryValue(value))
    expect(decoded).toEqual(value)
  })

  test('encodes equal objects the same whatever their key order', () => {
    expect(encodeHistoryValue({ a: 1, b: 2 })).toBe(encodeHistoryValue({ b: 2, a: 1 }))
  })
})

describe('DocumentHistory', () => {
  test('groups changes into sessions by author and gap', () => {
    const time = clock()
    const history = new DocumentHistory({ documentKind: 'design', now: time.now })
    const first = history.recordChange({ author: ana, summary: summary('Move') })
    time.advance(60_000)
    const second = history.recordChange({ author: ana, summary: summary('Resize') })
    const third = history.recordChange({ author: omar, summary: summary('Move') })
    time.advance(31 * 60_000)
    const fourth = history.recordChange({ author: omar, summary: summary('Move') })

    expect(second.sessionId).toBe(first.sessionId)
    expect(third.sessionId).not.toBe(second.sessionId)
    expect(fourth.sessionId).not.toBe(third.sessionId)
    expect(history.listChanges()).toHaveLength(4)
  })

  test('coalesces a continued step into the newest change', () => {
    const history = new DocumentHistory({ documentKind: 'design' })
    history.recordChange({ author: ana, summary: summary('Color') })
    history.recordChange({ author: ana, summary: summary('Color'), coalesce: true })
    expect(history.listChanges()).toHaveLength(1)
  })

  test('stores unchanged records once across versions', () => {
    const history = new DocumentHistory({ documentKind: 'writer' })
    const big = 'x'.repeat(10_000)
    history.saveVersion({
      author: ana,
      records: [
        ['a', big],
        ['b', 'one']
      ]
    })
    const afterFirst = history.storedTextLength
    history.saveVersion({
      author: ana,
      records: [
        ['a', big],
        ['b', 'two']
      ]
    })
    // Only the changed record is new.
    expect(history.storedTextLength - afterFirst).toBeLessThan(20)
  })

  test('skips an automatic version equal to the newest, never a named one', () => {
    const history = new DocumentHistory({ documentKind: 'writer' })
    const records: [string, unknown][] = [['a', 1]]
    expect(history.saveVersion({ author: ana, records })).not.toBeNull()
    expect(history.saveVersion({ author: ana, records })).toBeNull()
    const named = history.saveVersion({ author: ana, records, title: 'Final', description: 'Ok' })
    expect(named).toMatchObject({ kind: 'named', title: 'Final', description: 'Ok' })
  })

  test('renames versions, making an automatic one named and back', () => {
    const history = new DocumentHistory({ documentKind: 'writer' })
    const version = history.saveVersion({ author: ana, records: [['a', 1]] })
    if (!version) throw new Error('expected a version')
    expect(history.renameVersion(version.id, { title: 'Draft' }).kind).toBe('named')
    expect(history.renameVersion(version.id, { title: '' }).kind).toBe('auto')
  })

  test('diffs versions record by record', () => {
    const history = new DocumentHistory({ documentKind: 'writer' })
    const one = history.saveVersion({
      author: ana,
      records: [
        ['a', 1],
        ['b', 2]
      ]
    })
    const two = history.saveVersion({
      author: ana,
      records: [
        ['a', 1],
        ['b', 3],
        ['c', 4]
      ]
    })
    if (!one || !two) throw new Error('expected versions')
    expect(history.diffVersions(one.id, two.id)).toEqual({
      added: ['c'],
      removed: [],
      changed: ['b']
    })
    expect(history.diffWithCurrent(one.id, [['a', 2]])).toEqual({
      added: [],
      removed: ['b'],
      changed: ['a']
    })
  })

  test('prunes old automatic versions and changes, keeping named ones and the newest', () => {
    const time = clock()
    const history = new DocumentHistory({ documentKind: 'writer', now: time.now })
    const named = history.saveVersion({ author: ana, records: [['a', 0]], title: 'Keep' })
    for (let index = 1; index <= 5; index++) {
      history.recordChange({ author: ana, summary: summary(`Step ${index}`) })
      history.saveVersion({ author: ana, records: [['a', index]] })
      time.advance(1000)
    }
    history.prune({ maxAutoVersions: 2, maxAutoAgeMs: Number.POSITIVE_INFINITY, maxChanges: 3 })
    const versions = history.listVersions()
    expect(versions.map((version) => version.kind)).toEqual(['named', 'auto', 'auto'])
    expect(versions[0]?.id).toBe(named?.id)
    expect(history.listChanges()).toHaveLength(3)
    // Records only dropped versions used are gone.
    const state = history.toState()
    expect(Object.keys(state.blobs)).toHaveLength(3)
  })

  test('round-trips through its persisted state and rejects foreign data', () => {
    const history = new DocumentHistory({ documentKind: 'design' })
    history.recordChange({ author: ana, summary: summary('Move') })
    const version = history.saveVersion({ author: ana, records: [['k', new Uint8Array([7])]] })
    const copy = DocumentHistory.parse(structuredClone(history.toState()))
    if (!copy || !version) throw new Error('expected a history')
    expect(copy.listChanges()).toEqual(history.listChanges())
    expect(copy.versionRecords(version.id)).toEqual([['k', new Uint8Array([7])]])
    expect(DocumentHistory.parse({ format: 2 })).toBeNull()
  })
})
