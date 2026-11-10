import type { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { compact } from 'es-toolkit'

import { randomHex } from '@lawha/scene-graph/random'

import { updateWriterDocument, writerAuthor, writerDocument } from './session'

/** Comments on a range of text, stored as Word stores them: a mark in the text, the note apart. */

const segmenter = new Intl.Segmenter()

function initials(name: string): string {
  return compact(name.split(/\s+/u))
    .map((word) => segmenter.segment(word)[Symbol.iterator]().next().value?.segment ?? '')
    .join('')
    .slice(0, 3)
}

/** Comments the selected text; false when nothing is selected. */
export function addComment(editor: Editor, text: string): boolean {
  if (editor.state.selection.empty || !text.trim()) return false
  const id = `c-${randomHex(6)}`
  const author = writerAuthor.value.trim() || 'Lawha'
  editor.chain().focus().setComment(id).run()
  updateWriterDocument({
    comments: [
      ...writerDocument.value.comments,
      { id, author, initials: initials(author), date: new Date().toISOString(), text: text.trim() }
    ]
  })
  return true
}

export function setCommentResolved(id: string, resolved: boolean): void {
  updateWriterDocument({
    comments: writerDocument.value.comments.map((comment) =>
      comment.id === id ? { ...comment, resolved } : comment
    )
  })
}

export function deleteComment(editor: Editor, id: string): void {
  editor.commands.unsetComment(id)
  updateWriterDocument({
    comments: writerDocument.value.comments.filter((comment) => comment.id !== id)
  })
}

/** The text a comment is on, as document positions. */
export function commentRange(editor: Editor, id: string): { from: number; to: number } | null {
  let from = -1
  let to = -1
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText) return true
    if (node.marks.some((mark) => mark.type.name === 'comment' && mark.attrs.commentId === id)) {
      if (from < 0) from = pos
      to = pos + node.nodeSize
    }
    return false
  })
  return from < 0 ? null : { from, to }
}

export function selectComment(editor: Editor, id: string): void {
  const range = commentRange(editor, id)
  if (!range) return
  editor.view.dispatch(
    editor.state.tr
      .setSelection(TextSelection.create(editor.state.doc, range.from, range.to))
      .scrollIntoView()
  )
  editor.commands.focus()
}

/** The quoted text of a comment, for the side panel. */
export function commentQuote(editor: Editor, id: string): string {
  const range = commentRange(editor, id)
  return range ? editor.state.doc.textBetween(range.from, range.to, ' ') : ''
}
