import { describe, expect, test } from 'bun:test'

import { getSchema } from '@tiptap/core'
import { EditorState } from '@tiptap/pm/state'

import { writerExtensions } from '@/app/writer/editor/extensions'
import { findMatches, replaceMatches } from '@/app/writer/editor/search'

const schema = getSchema(writerExtensions())
const doc = schema.nodeFromJSON({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'الطرف ' },
        { type: 'text', text: 'الأول', marks: [{ type: 'bold' }] },
        { type: 'text', text: ' والطرف الأول' }
      ]
    },
    { type: 'paragraph', content: [{ type: 'text', text: 'Party One and party one' }] }
  ]
})

describe('find and replace', () => {
  test('finds matches across formatting, never across paragraphs', () => {
    const matches = findMatches(doc, { text: 'الطرف الأول', matchCase: false })
    expect(matches).toHaveLength(2)
    expect(doc.textBetween(matches[0].from, matches[0].to)).toBe('الطرف الأول')
    expect(findMatches(doc, { text: 'الأولParty', matchCase: false })).toEqual([])
  })

  test('matches case only when asked', () => {
    expect(findMatches(doc, { text: 'party one', matchCase: false })).toHaveLength(2)
    expect(findMatches(doc, { text: 'party one', matchCase: true })).toHaveLength(1)
  })

  test('replaces every match and keeps the surrounding formatting', () => {
    const state = EditorState.create({ doc })
    const matches = findMatches(doc, { text: 'الأول', matchCase: false })
    const next = state.apply(replaceMatches(state.tr, matches, 'الثاني')).doc
    expect(next.textContent).toBe('الطرف الثاني والطرف الثانيParty One and party one')
    expect(next.firstChild?.child(1).marks.map((mark) => mark.type.name)).toEqual(['bold'])
  })
})
