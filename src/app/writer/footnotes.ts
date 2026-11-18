import type { Editor } from '@tiptap/core'

import { removeFootnote } from '@lawha/core/writer'

import { updateWriterDocument, writerDocument } from './session'

/**
 * Deletes a footnote: its references leave the body through the editor, so undo brings them
 * back, and the note leaves the document's footnotes.
 */
export function removeWriterFootnote(editor: Editor, id: string): void {
  const ranges: Array<{ from: number; to: number }> = []
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'footnote' && node.attrs.id === id) {
      ranges.push({ from: pos, to: pos + node.nodeSize })
    }
  })
  if (ranges.length) {
    const tr = editor.state.tr
    for (const range of ranges.reverse()) tr.delete(range.from, range.to)
    editor.view.dispatch(tr)
  }
  updateWriterDocument({ footnotes: removeFootnote(writerDocument.value, id).footnotes })
}
