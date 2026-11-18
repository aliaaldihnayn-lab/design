import { stringAttr, type WriterDocument, type WriterFootnote, type WriterNode } from './model'

/**
 * Footnotes as Word numbers them: by where their references first appear in the body, whatever
 * order the notes are stored in. The editor's notes area, the PDF export, and Word export read
 * the same numbering, and editing or removing a note goes through here.
 */

/** Ids of the footnotes the body refers to, in reading order, each once. */
export function footnoteOrder(body: WriterNode): string[] {
  const ids: string[] = []
  const seen = new Set<string>()
  const visit = (node: WriterNode) => {
    if (node.type === 'footnote') {
      const id = stringAttr(node.attrs, 'id')
      if (id && !seen.has(id)) {
        seen.add(id)
        ids.push(id)
      }
    }
    node.content?.forEach(visit)
  }
  visit(body)
  return ids
}

export interface NumberedFootnote extends WriterFootnote {
  /** 1-based, by first reference; null for a note nothing refers to any more. */
  number: number | null
}

/** The document's notes, referenced ones first in reference order, then any left unreferenced. */
export function numberedFootnotes(doc: Pick<WriterDocument, 'body' | 'footnotes'>) {
  const byId = new Map(doc.footnotes.map((note) => [note.id, note]))
  const numbered: NumberedFootnote[] = []
  for (const id of footnoteOrder(doc.body)) {
    const note = byId.get(id)
    if (note) numbered.push({ ...note, number: numbered.length + 1 })
  }
  const referenced = new Set(numbered.map((note) => note.id))
  for (const note of doc.footnotes) {
    if (!referenced.has(note.id)) numbered.push({ ...note, number: null })
  }
  return numbered
}

/** The 1-based number of each referenced note by id. */
export function footnoteNumbers(body: WriterNode): Map<string, number> {
  return new Map(footnoteOrder(body).map((id, index) => [id, index + 1]))
}

/** Replaces a note's paragraphs; a note that does not exist is added. */
export function setFootnoteContent(
  doc: WriterDocument,
  id: string,
  content: WriterNode[]
): WriterDocument {
  const exists = doc.footnotes.some((note) => note.id === id)
  const footnotes = exists
    ? doc.footnotes.map((note) => (note.id === id ? { ...note, content } : note))
    : [...doc.footnotes, { id, content }]
  return { ...doc, footnotes }
}

function withoutReferences(node: WriterNode, id: string): WriterNode {
  if (!node.content) return node
  const content = node.content
    .filter((child) => !(child.type === 'footnote' && stringAttr(child.attrs, 'id') === id))
    .map((child) => withoutReferences(child, id))
  return { ...node, content }
}

/** Removes a note and every reference to it from the body. */
export function removeFootnote(doc: WriterDocument, id: string): WriterDocument {
  return {
    ...doc,
    body: withoutReferences(doc.body, id),
    footnotes: doc.footnotes.filter((note) => note.id !== id)
  }
}
