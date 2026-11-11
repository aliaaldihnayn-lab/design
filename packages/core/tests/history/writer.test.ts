import { describe, expect, test } from 'bun:test'

import {
  diffWriterDocuments,
  diffWriterText,
  DocumentHistory,
  summarizeWriterChange,
  writerFromRecords,
  writerRecords
} from '@lawha/core/history'
import { createWriterDocument, type WriterNode } from '@lawha/core/writer'

const paragraph = (text: string, bold = false): WriterNode => ({
  type: 'paragraph',
  content: [{ type: 'text', text, ...(bold ? { marks: [{ type: 'bold' }] } : {}) }]
})
const doc = (...blocks: WriterNode[]) =>
  createWriterDocument({ body: { type: 'doc', content: blocks }, title: 'Report' })

describe('writer history', () => {
  test('round-trips a document through records', () => {
    const document = doc(paragraph('One'), paragraph('Two'))
    document.comments = [{ id: 'c1', author: 'Ana', date: '2026-01-01', text: 'Hi' }]
    expect(writerFromRecords(writerRecords(document))).toEqual(document)
  })

  test('stores an unchanged paragraph once across versions', () => {
    const history = new DocumentHistory({ documentKind: 'writer' })
    const author = { id: 'a', name: 'A', avatarUrl: null, color: null }
    const long = paragraph('x'.repeat(5000))
    history.saveVersion({ author, records: writerRecords(doc(long, paragraph('a'))) })
    const before = history.storedTextLength
    history.saveVersion({ author, records: writerRecords(doc(long, paragraph('b'))) })
    expect(history.storedTextLength - before).toBeLessThan(200)
  })

  test('diffs paragraphs and the words inside a changed one', () => {
    const before = doc(paragraph('Intro'), paragraph('The quick fox'), paragraph('Gone'))
    const after = doc(paragraph('Intro'), paragraph('The slow fox'), paragraph('New end'))
    const diff = diffWriterDocuments(before, after)
    expect(diff.map((entry) => entry.kind)).toEqual(['same', 'changed', 'changed'])
    const changed = diff[1]
    if (changed?.kind !== 'changed') throw new Error('expected a changed paragraph')
    expect(changed.runs).toEqual([
      { op: 'equal', text: 'The ' },
      { op: 'delete', text: 'quick' },
      { op: 'insert', text: 'slow' },
      { op: 'equal', text: ' fox' }
    ])
  })

  test('reports added and removed paragraphs and formatting-only changes', () => {
    const before = doc(paragraph('A'), paragraph('B'))
    const added = diffWriterDocuments(before, doc(paragraph('A'), paragraph('B'), paragraph('C')))
    expect(added.map((entry) => entry.kind)).toEqual(['same', 'same', 'added'])
    const removed = diffWriterDocuments(before, doc(paragraph('B')))
    expect(removed.map((entry) => entry.kind)).toEqual(['removed', 'same'])
    const bolded = diffWriterDocuments(before, doc(paragraph('A', true), paragraph('B')))
    const first = bolded[0]
    expect(first?.kind).toBe('changed')
    if (first?.kind === 'changed') expect(first.runs).toEqual([{ op: 'equal', text: 'A' }])
  })

  test('diffs Arabic text word by word', () => {
    expect(diffWriterText('مرحبا بالعالم', 'مرحبا بكم')).toEqual([
      { op: 'equal', text: 'مرحبا ' },
      { op: 'delete', text: 'بالعالم' },
      { op: 'insert', text: 'بكم' }
    ])
  })

  test('summarizes an edit by the paragraphs it touched', () => {
    const before = doc(paragraph('Heading'), paragraph('Body'))
    expect(summarizeWriterChange(before, doc(paragraph('Heading!'), paragraph('Body')))).toEqual({
      action: 'edit-text',
      count: 1,
      names: ['Heading!'],
      label: 'Edit'
    })
    expect(summarizeWriterChange(before, doc(paragraph('Heading')))).toMatchObject({
      action: 'delete',
      names: ['Body']
    })
  })
})
