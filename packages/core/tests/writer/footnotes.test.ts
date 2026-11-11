import { describe, expect, test } from 'bun:test'

import {
  createWriterDocument,
  footnoteOrder,
  numberedFootnotes,
  removeFootnote,
  setFootnoteContent,
  type WriterNode
} from '@lawha/core/writer'

const ref = (id: string): WriterNode => ({ type: 'footnote', attrs: { id } })
const text = (value: string): WriterNode => ({ type: 'text', text: value })
const note = (id: string, value: string) => ({
  id,
  content: [{ type: 'paragraph', content: [text(value)] }]
})

function documentWithNotes() {
  return createWriterDocument({
    body: {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [text('أول'), ref('b'), text(' then '), ref('a')] },
        { type: 'paragraph', content: [text('again'), ref('b')] }
      ]
    },
    footnotes: [note('a', 'note A'), note('b', 'note B'), note('orphan', 'unused')]
  })
}

describe('footnotes', () => {
  test('are numbered by first reference, unreferenced notes last without a number', () => {
    const document = documentWithNotes()
    expect(footnoteOrder(document.body)).toEqual(['b', 'a'])
    expect(numberedFootnotes(document).map(({ id, number }) => [id, number])).toEqual([
      ['b', 1],
      ['a', 2],
      ['orphan', null]
    ])
  })

  test('edit a note in place and keep the others', () => {
    const edited = setFootnoteContent(documentWithNotes(), 'a', note('a', 'changed').content)
    expect(edited.footnotes.map((entry) => entry.id)).toEqual(['a', 'b', 'orphan'])
    expect(edited.footnotes[0]?.content[0]?.content?.[0]?.text).toBe('changed')
    expect(edited.footnotes[1]?.content[0]?.content?.[0]?.text).toBe('note B')
  })

  test('removing a note drops every reference to it and renumbers the rest', () => {
    const removed = removeFootnote(documentWithNotes(), 'b')
    expect(footnoteOrder(removed.body)).toEqual(['a'])
    expect(removed.footnotes.map((entry) => entry.id)).toEqual(['a', 'orphan'])
    expect(numberedFootnotes(removed)[0]).toMatchObject({ id: 'a', number: 1 })
  })
})
