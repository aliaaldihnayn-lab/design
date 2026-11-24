import { describe, expect, test } from 'bun:test'

import { getSchema } from '@tiptap/core'
import { EditorState, TextSelection } from '@tiptap/pm/state'

import { writerExtensions } from '@/app/writer/editor/extensions'
import {
  resolveChanges,
  trackChangesPlugin,
  trackedChanges
} from '@/app/writer/editor/track-changes'

const schema = getSchema(writerExtensions())
let enabled = true
const plugin = trackChangesPlugin({
  enabled: () => enabled,
  author: () => 'Ali',
  now: () => '2026-11-10T00:00:00Z'
})

function stateWith(text: string, cursor: number) {
  const doc = schema.nodeFromJSON({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }]
  })
  const state = EditorState.create({ doc, plugins: [plugin] })
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, cursor)))
}

describe('track changes', () => {
  test('typed text is recorded as the author’s insertion', () => {
    let state = stateWith('عقد', 4)
    state = state.apply(state.tr.insertText(' جديد'))
    expect(trackedChanges(state.doc)).toEqual([
      {
        type: 'insertion',
        from: 4,
        to: 9,
        author: 'Ali',
        date: '2026-11-10T00:00:00Z',
        text: ' جديد'
      }
    ])
  })

  test('a word typed letter by letter is one insertion, though each key has its own time', () => {
    let tick = 0
    const ticking = trackChangesPlugin({
      enabled: () => true,
      author: () => 'Ali',
      now: () => `2026-11-10T00:00:0${tick++}Z`
    })
    const doc = schema.nodeFromJSON({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'عقد' }] }]
    })
    let state = EditorState.create({ doc, plugins: [ticking] })
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 4)))
    for (const letter of ' جديد') state = state.apply(state.tr.insertText(letter))
    // One run with one mark, which Word gets as one `w:ins`.
    const runs: unknown[] = state.doc.toJSON().content[0].content
    expect(runs).toEqual([
      { type: 'text', text: 'عقد' },
      {
        type: 'text',
        text: ' جديد',
        marks: [{ type: 'insertion', attrs: { author: 'Ali', date: '2026-11-10T00:00:00Z' } }]
      }
    ])
  })

  test('backspace keeps the text, struck through, and the caret moves before it', () => {
    let state = stateWith('abc', 4)
    state = state.apply(state.tr.delete(3, 4))
    expect(state.doc.textContent).toBe('abc')
    expect(trackedChanges(state.doc).map((change) => [change.type, change.text])).toEqual([
      ['deletion', 'c']
    ])
    expect(state.selection.from).toBe(3)
    // Backspacing again strikes the next letter rather than removing the struck one.
    state = state.apply(state.tr.delete(2, 3))
    expect(state.doc.textContent).toBe('abc')
    expect(trackedChanges(state.doc).map((change) => change.text)).toEqual(['bc'])
  })

  test('deleting your own pending insertion removes it outright', () => {
    let state = stateWith('ab', 3)
    state = state.apply(state.tr.insertText('X'))
    state = state.apply(state.tr.delete(3, 4))
    expect(state.doc.textContent).toBe('ab')
    expect(trackedChanges(state.doc)).toEqual([])
  })

  test('accepting and rejecting resolves the marks', () => {
    let state = stateWith('ab', 3)
    state = state.apply(state.tr.insertText('X'))
    state = state.apply(state.tr.delete(1, 2))
    const changes = trackedChanges(state.doc)
    expect(changes.map((change) => change.type).sort()).toEqual(['deletion', 'insertion'])
    const accepted = state.apply(resolveChanges(state, changes, true))
    expect(accepted.doc.textContent).toBe('bX')
    expect(trackedChanges(accepted.doc)).toEqual([])
    const rejected = state.apply(resolveChanges(state, changes, false))
    expect(rejected.doc.textContent).toBe('ab')
  })

  test('records nothing while switched off', () => {
    enabled = false
    let state = stateWith('ab', 3)
    state = state.apply(state.tr.insertText('X'))
    enabled = true
    expect(trackedChanges(state.doc)).toEqual([])
  })
})
