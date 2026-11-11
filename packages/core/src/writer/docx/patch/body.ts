import type { Element } from '@xmldom/xmldom'

import type { PartWriter } from '#core/writer/docx/write'
import { attrOf, kid, kids, NS } from '#core/writer/docx/xml'
import type { WriterNode } from '#core/writer/model'

import { canonical, commonSubsequence } from './canonical'
import { adopt, importMarkup, insertBefore, ownerOf, replaceNode } from './dom'

/**
 * The body of a patched package. Blocks the model still holds unchanged are written as the XML
 * they were read from, with their styles, bookmarks, text boxes, fields, and anything else the
 * model does not keep; edited blocks are written anew, keeping the paragraph properties of the
 * paragraph they replace.
 */

/** Read blocks that share source elements, as a paragraph a page break splits does. */
export interface Chunk {
  nodes: WriterNode[]
  elements: Element[]
}

export function chunksOf(blocks: ReadonlyArray<{ node: WriterNode; sources: Element[] }>): Chunk[] {
  const chunks: Chunk[] = []
  for (const block of blocks) {
    const last = chunks.at(-1)
    if (last && block.sources.some((source) => last.elements.includes(source))) {
      last.nodes.push(block.node)
      for (const source of block.sources) {
        if (!last.elements.includes(source)) last.elements.push(source)
      }
    } else chunks.push({ nodes: [block.node], elements: [...block.sources] })
  }
  return chunks
}

/** Paragraph properties in schema order, so merged ones stay valid. */
const PPR_ORDER = [
  'pStyle',
  'keepNext',
  'keepLines',
  'pageBreakBefore',
  'framePr',
  'widowControl',
  'numPr',
  'suppressLineNumbers',
  'pBdr',
  'shd',
  'tabs',
  'suppressAutoHyphens',
  'kinsoku',
  'wordWrap',
  'overflowPunct',
  'topLinePunct',
  'autoSpaceDE',
  'autoSpaceDN',
  'bidi',
  'adjustRightInd',
  'snapToGrid',
  'spacing',
  'ind',
  'contextualSpacing',
  'mirrorIndents',
  'suppressOverlap',
  'jc',
  'textDirection',
  'textAlignment',
  'textboxTightWrap',
  'outlineLvl',
  'divId',
  'cnfStyle',
  'rPr',
  'sectPr',
  'pPrChange'
]

/** What the model decides about a paragraph, which the replaced paragraph's never override. */
const MODEL_DECIDES = new Set(['sectPr', 'rPr', 'numPr', 'bidi', 'jc'])

const rankOf = (element: Element) => PPR_ORDER.indexOf(element.localName ?? '')

/**
 * An edited paragraph takes the properties of the paragraph it replaces (spacing, indents,
 * borders, its style while it stays the same kind of block) with the model's own over them.
 * Where the old paragraph's style made it right-to-left or aligned it and the model no longer
 * does, the new paragraph says so, or the style would win.
 */
function keepParagraphProperties(
  generated: Element,
  original: Element,
  node: WriterNode,
  read: WriterNode
): void {
  const owner = ownerOf(generated)
  const originalPPr = kid(original, 'pPr')
  if (!originalPPr) return
  const own = kid(generated, 'pPr')
  const merged = adopt(owner, originalPPr)
  const ownChildren = kids(own)
  const ownNames = new Set(ownChildren.map((child) => child.localName ?? ''))
  const keepStyle = !ownNames.has('pStyle') && node.type === read.type
  for (const child of kids(merged)) {
    const name = child.localName ?? ''
    if (MODEL_DECIDES.has(name) || (name === 'pStyle' && !keepStyle)) merged.removeChild(child)
  }
  const setting = (name: string, value: string) => {
    const element = owner.createElementNS(NS.w, `w:${name}`)
    element.setAttributeNS(NS.w, 'w:val', value)
    return element
  }
  if (!ownNames.has('bidi') && read.attrs?.dir === 'rtl') ownChildren.push(setting('bidi', '0'))
  if (!ownNames.has('jc') && read.attrs?.textAlign) ownChildren.push(setting('jc', 'left'))
  for (const child of ownChildren) {
    const later = kids(merged).find((other) => rankOf(other) > rankOf(child))
    insertBefore(merged, child, later ?? null)
  }
  if (own) replaceNode(own, merged)
  else insertBefore(generated, merged, generated.firstChild)
}

const isParagraph = (node: WriterNode | undefined) =>
  node?.type === 'paragraph' || node?.type === 'heading'

/** For each read chunk the model keeps whole, the index of the first model block it stands for. */
function keptChunks(chunks: readonly Chunk[], blocks: readonly WriterNode[]): Map<number, number> {
  const flat = chunks.flatMap((chunk) => chunk.nodes)
  const pairs = commonSubsequence(flat.map(canonical), blocks.map(canonical))
  const matched = new Map(pairs)
  const kept = new Map<number, number>()
  let offset = 0
  chunks.forEach((chunk, index) => {
    const targets = chunk.nodes.map((_, at) => matched.get(offset + at))
    const first = targets[0]
    if (first !== undefined && targets.every((target, at) => target === first + at)) {
      kept.set(first, index)
    }
    offset += chunk.nodes.length
  })
  return kept
}

/** Writes edited blocks, giving a paragraph the properties of the one it took the place of. */
function insertEdited(
  body: Element,
  sectPr: Element | null,
  run: readonly WriterNode[],
  xml: readonly string[],
  replaced: readonly Chunk[]
): void {
  run.forEach((node, index) => {
    const elements = importMarkup(body, xml[index] ?? '')
    const original = replaced.at(index)
    const source = original?.elements.length === 1 ? original.elements[0] : null
    const read = original?.nodes.length === 1 ? original.nodes[0] : undefined
    const element = elements.length === 1 ? elements[0] : null
    if (element && read && isParagraph(node) && isParagraph(read) && source?.localName === 'p') {
      keepParagraphProperties(element, source, node, read)
    }
    for (const created of elements) insertBefore(body, created, sectPr)
  })
}

/** Rewrites the body's blocks; returns the markup written anew, for the styles it names. */
export function patchBody(
  body: Element,
  chunks: readonly Chunk[],
  blocks: readonly WriterNode[],
  part: PartWriter,
  textWidth: number
): string {
  const keptAt = keptChunks(chunks, blocks)
  const keptIndices = new Set(keptAt.values())
  const sectPr = kid(body, 'sectPr')
  for (const child of kids(body)) if (child !== sectPr) body.removeChild(child)
  let generated = ''
  let lastKept = -1
  let at = 0
  while (at < blocks.length) {
    const kept = keptAt.get(at)
    if (kept !== undefined) {
      const chunk = chunks[kept]
      for (const element of chunk.elements) insertBefore(body, element, sectPr)
      at += chunk.nodes.length
      lastKept = kept
      continue
    }
    const start = at
    while (at < blocks.length && !keptAt.has(at)) at += 1
    const nextKept = keptAt.get(at) ?? chunks.length
    const from = lastKept + 1
    const replaced = chunks
      .slice(from, nextKept)
      .filter((_, offset) => !keptIndices.has(from + offset))
    const run = blocks.slice(start, at)
    const xml = part.eachBlock(run, textWidth)
    generated += xml.join('')
    insertEdited(body, sectPr, run, xml, replaced)
  }
  const closing = part.closeOpenComments()
  const last = kids(body).findLast((child) => child !== sectPr)
  if (closing && last?.localName === 'p') {
    for (const element of importMarkup(body, closing)) last.appendChild(element)
  }
  return generated
}

/** The page size and margins of a section's `w:sectPr`, written over what it had. */
const BEFORE_PAGE_SIZE = new Set([
  'headerReference',
  'footerReference',
  'footnotePr',
  'endnotePr',
  'type'
])

export function setSectionPage(
  sectPr: Element,
  page: {
    width: number
    height: number
    margins: Record<'top' | 'right' | 'bottom' | 'left' | 'header' | 'footer', number>
  }
): void {
  const owner = ownerOf(sectPr)
  let size = kid(sectPr, 'pgSz')
  if (!size) {
    size = owner.createElementNS(NS.w, 'w:pgSz')
    const after = kids(sectPr).find((child) => !BEFORE_PAGE_SIZE.has(child.localName ?? ''))
    insertBefore(sectPr, size, after ?? null)
  }
  let margins = kid(sectPr, 'pgMar')
  if (!margins) {
    margins = owner.createElementNS(NS.w, 'w:pgMar')
    insertBefore(sectPr, margins, size.nextSibling)
  }
  size.setAttributeNS(NS.w, 'w:w', String(page.width))
  size.setAttributeNS(NS.w, 'w:h', String(page.height))
  if (page.width > page.height) size.setAttributeNS(NS.w, 'w:orient', 'landscape')
  else if (attrOf(size, 'orient')) size.setAttributeNS(NS.w, 'w:orient', 'portrait')
  for (const side of ['top', 'right', 'bottom', 'left', 'header', 'footer'] as const) {
    margins.setAttributeNS(NS.w, `w:${side}`, String(page.margins[side]))
  }
}
