import {
  detectDirection,
  documentStatistics,
  nodeText,
  numberAttr,
  stringAttr,
  type TextAlign,
  type TextDirection,
  type WriterDocument,
  type WriterMark,
  type WriterNode
} from './model'

/**
 * Edits on the model model in the terms people and agents use: numbered blocks, plain text
 * with simple formatting, find and replace, comments on a quoted phrase. The AI tools and the
 * editor's own commands share them, so both change documents the same way.
 */

/** A block written from plain values, as the AI tools and templates describe content. */
export interface BlockSpec {
  type: 'paragraph' | 'heading' | 'bullet' | 'numbered' | 'pageBreak' | 'table'
  text?: string
  /** Heading level 1–6. */
  level?: number
  dir?: TextDirection
  align?: TextAlign
  bold?: boolean
  italic?: boolean
  /** Rows of cell texts, for tables; the first row is a header row when `header` is set. */
  rows?: string[][]
  header?: boolean
}

function textNodes(text: string, marks: WriterMark[]): WriterNode[] {
  const parts = text.split('\n')
  return parts.flatMap((part, index) => {
    const nodes: WriterNode[] = index > 0 ? [{ type: 'hardBreak' }] : []
    if (part)
      nodes.push(marks.length ? { type: 'text', text: part, marks } : { type: 'text', text: part })
    return nodes
  })
}

function paragraphOf(spec: BlockSpec, type: 'paragraph' | 'heading' = 'paragraph'): WriterNode {
  const text = spec.text ?? ''
  const attrs: Record<string, unknown> = { dir: spec.dir ?? detectDirection(text) ?? 'auto' }
  if (spec.align) attrs.textAlign = spec.align
  if (type === 'heading') attrs.level = Math.min(6, Math.max(1, spec.level ?? 1))
  const marks: WriterMark[] = []
  if (spec.bold) marks.push({ type: 'bold' })
  if (spec.italic) marks.push({ type: 'italic' })
  const content = textNodes(text, marks)
  return content.length ? { type, attrs, content } : { type, attrs }
}

function tableOf(spec: BlockSpec): WriterNode {
  const rows = spec.rows?.length ? spec.rows : [['']]
  const dir = spec.dir ?? detectDirection(rows.flat().join(' ')) ?? 'auto'
  return {
    type: 'table',
    attrs: { dir },
    content: rows.map((cells, rowIndex) => ({
      type: 'tableRow',
      content: cells.map((cell) => ({
        type: spec.header && rowIndex === 0 ? 'tableHeader' : 'tableCell',
        attrs: { colspan: 1, rowspan: 1, colwidth: null },
        content: [paragraphOf({ type: 'paragraph', text: cell, dir: spec.dir })]
      }))
    }))
  }
}

/** Builds blocks from specs; consecutive list items join one list. */
export function blocksFromSpecs(specs: readonly BlockSpec[]): WriterNode[] {
  const blocks: WriterNode[] = []
  for (const spec of specs) {
    if (spec.type === 'bullet' || spec.type === 'numbered') {
      const listType = spec.type === 'bullet' ? 'bulletList' : 'orderedList'
      const item: WriterNode = { type: 'listItem', content: [paragraphOf(spec)] }
      const last = blocks.at(-1)
      if (last?.type === listType) last.content = [...(last.content ?? []), item]
      else blocks.push({ type: listType, content: [item] })
    } else if (spec.type === 'heading') blocks.push(paragraphOf(spec, 'heading'))
    else if (spec.type === 'pageBreak') blocks.push({ type: 'pageBreak' })
    else if (spec.type === 'table') blocks.push(tableOf(spec))
    else blocks.push(paragraphOf(spec))
  }
  return blocks
}

/** A top-level block as the AI tools show it. */
export interface BlockSummary {
  index: number
  type: string
  text: string
  level?: number
  dir?: string
  align?: string
  items?: string[]
}

export function outlineOf(model: WriterDocument) {
  const blocks: BlockSummary[] = (model.body.content ?? []).map((block, index) => {
    const summary: BlockSummary = { index, type: block.type, text: nodeText(block) }
    const level = numberAttr(block.attrs, 'level')
    if (level !== null) summary.level = level
    const dir = stringAttr(block.attrs, 'dir')
    if (dir) summary.dir = dir
    const align = stringAttr(block.attrs, 'textAlign')
    if (align) summary.align = align
    if (block.type === 'bulletList' || block.type === 'orderedList') {
      summary.items = (block.content ?? []).map(nodeText)
    }
    return summary
  })
  return {
    title: model.title,
    page: model.page,
    header: model.header ? nodeText(model.header) : null,
    footer: model.footer ? nodeText(model.footer) : null,
    trackChanges: model.trackChanges,
    comments: model.comments,
    statistics: documentStatistics(model.body),
    blocks
  }
}

function withBody(model: WriterDocument, content: WriterNode[]): WriterDocument {
  return {
    ...model,
    body: { ...model.body, content: content.length ? content : [{ type: 'paragraph' }] }
  }
}

function checkIndex(model: WriterDocument, index: number, allowEnd = false): void {
  const count = model.body.content?.length ?? 0
  if (index < 0 || index > count || (!allowEnd && index === count)) {
    throw new RangeError(`Block ${index} does not exist; the model has blocks 0 to ${count - 1}`)
  }
}

export function insertBlocks(
  model: WriterDocument,
  at: number,
  blocks: WriterNode[]
): WriterDocument {
  checkIndex(model, at, true)
  const content = [...(model.body.content ?? [])]
  content.splice(at, 0, ...blocks)
  return withBody(model, content)
}

export function deleteBlocks(model: WriterDocument, from: number, count = 1): WriterDocument {
  checkIndex(model, from)
  const content = [...(model.body.content ?? [])]
  content.splice(from, count)
  return withBody(model, content)
}

export function replaceBlock(
  model: WriterDocument,
  index: number,
  block: WriterNode
): WriterDocument {
  checkIndex(model, index)
  const content = [...(model.body.content ?? [])]
  content[index] = block
  return withBody(model, content)
}

function mapText(node: WriterNode, map: (text: string) => string): WriterNode {
  if (node.type === 'text') return { ...node, text: map(node.text ?? '') }
  if (!node.content) return node
  return {
    ...node,
    content: node.content
      .map((child) => mapText(child, map))
      .filter((child) => child.type !== 'text' || child.text)
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Replaces text everywhere in the body, header and footer; a match stays within one run. */
export function replaceText(
  model: WriterDocument,
  find: string,
  replacement: string,
  matchCase = false
): { model: WriterDocument; count: number } {
  if (!find) return { model, count: 0 }
  const pattern = new RegExp(escapeRegExp(find), matchCase ? 'gu' : 'giu')
  let count = 0
  const map = (text: string) =>
    text.replace(pattern, () => {
      count += 1
      return replacement
    })
  const next: WriterDocument = {
    ...model,
    body: mapText(model.body, map),
    header: model.header ? mapText(model.header, map) : null,
    footer: model.footer ? mapText(model.footer, map) : null
  }
  return { model: count ? next : model, count }
}

/** Puts a comment mark on the first occurrence of `quote` inside block `index`. */
export function commentOnQuote(
  model: WriterDocument,
  index: number,
  quote: string,
  commentId: string
): WriterDocument {
  checkIndex(model, index)
  const found = { done: false }
  const visit = (node: WriterNode): WriterNode => {
    if (found.done || !node.content) return node
    const content: WriterNode[] = []
    for (const child of node.content) {
      const at = !found.done && child.type === 'text' ? (child.text ?? '').indexOf(quote) : -1
      if (at < 0) {
        content.push(visit(child))
        continue
      }
      const text = child.text ?? ''
      const marks = child.marks ?? []
      const piece = (value: string, extra: WriterMark[] = []): WriterNode[] => {
        if (!value) return []
        const all = [...marks, ...extra]
        return [all.length ? { ...child, text: value, marks: all } : { type: 'text', text: value }]
      }
      content.push(
        ...piece(text.slice(0, at)),
        ...piece(quote, [{ type: 'comment', attrs: { commentId } }]),
        ...piece(text.slice(at + quote.length))
      )
      found.done = true
    }
    return { ...node, content }
  }
  const block = visit(model.body.content?.[index] ?? { type: 'paragraph' })
  if (!found.done) throw new Error(`“${quote}” is not in block ${index}`)
  return replaceBlock(model, index, block)
}
