import type { Element } from '@xmldom/xmldom'
import { omit } from 'es-toolkit'

import type { PartWriter } from '#core/writer/docx/write'
import { attrOf, find, kid, kids, NS } from '#core/writer/docx/xml'
import type { WriterNode } from '#core/writer/model'

import { canonical, commonSubsequence, sameNode } from './canonical'
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

/** Run content the model has no node for: text boxes, shapes, charts, embedded objects. */
function holdsUnreadObject(run: Element): boolean {
  return kids(run).some((child) => {
    const name = child.localName ?? ''
    if (name === 'AlternateContent' || name === 'object') return true
    // A drawing with a picture reads as an image; one without (a shape, chart, or text box) not.
    return (
      (name === 'drawing' || name === 'pict') && !find(child, 'blip') && !find(child, 'imagedata')
    )
  })
}

/**
 * An edited paragraph keeps what the model cannot hold of the one it replaces: its floating
 * objects (text boxes, shapes), which anchor to the paragraph rather than to a place in its
 * text, at its start, and its bookmarks that begin and end in it (cross-reference and table of
 * contents targets) around its text.
 */
function keepUnreadContent(generated: Element, original: Element): void {
  const owner = ownerOf(generated)
  const pPr = kid(generated, 'pPr')
  const start = pPr ? pPr.nextSibling : generated.firstChild
  for (const run of kids(original, 'r').filter(holdsUnreadObject)) {
    insertBefore(generated, adopt(owner, run), start)
  }
  const ends = new Set(kids(original, 'bookmarkEnd').map((end) => attrOf(end, 'id')))
  for (const bookmark of kids(original, 'bookmarkStart')) {
    const id = attrOf(bookmark, 'id')
    const end = kids(original, 'bookmarkEnd').find((candidate) => attrOf(candidate, 'id') === id)
    if (!end || !ends.has(id)) continue
    insertBefore(generated, adopt(owner, bookmark), pPr ? pPr.nextSibling : generated.firstChild)
    generated.appendChild(adopt(owner, end))
  }
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

/** A read block the edited ones replace, with the one element it was read from, if one. */
interface ReplacedBlock {
  read: WriterNode
  source: Element | null
}

/** The read blocks of the chunks a run replaces, one by one, beside the run's blocks. */
function replacedBlocks(replaced: readonly Chunk[]): ReplacedBlock[] {
  return replaced.flatMap((chunk) =>
    chunk.nodes.map((read) => ({
      read,
      source: chunk.elements.length === 1 ? chunk.elements[0] : null
    }))
  )
}

const REGIONS = ['header', 'footer'] as const

/**
 * The section break the run writes for one read from Word: a header or footer it still has as
 * read is left out, so no new part is written for it and the read section's own reference is
 * kept (`keepSectionProperties`); one removed is an empty region, so Word shows none.
 */
function sectionToWrite(node: WriterNode, read: WriterNode): WriterNode {
  const changed = REGIONS.filter(
    (kind) =>
      !sameNode(read.attrs?.[kind] as WriterNode | null, node.attrs?.[kind] as WriterNode | null)
  )
  const attrs = omit(node.attrs ?? {}, REGIONS)
  for (const kind of changed) {
    const region = node.attrs?.[kind]
    if (region !== undefined) attrs[kind] = region ?? { type: 'doc', content: [] }
  }
  return { ...node, attrs }
}

/**
 * A section break written anew keeps the section properties it was read with (its type,
 * columns, page numbering, first-page and even-page headers) with the model's page over them,
 * and the header and footer references the model did not change.
 */
function keepSectionProperties(generated: Element, original: Element): void {
  const merged = adopt(ownerOf(generated), original)
  const written = new Set<string>(
    kids(generated)
      .map((child) => child.localName ?? '')
      .filter((name) => name === 'headerReference' || name === 'footerReference')
  )
  // The model holds each section's default header and footer; first-page and even-page ones
  // stay as read.
  for (const child of kids(merged)) {
    const type = attrOf(child, 'type') ?? 'default'
    if (written.has(child.localName ?? '') && type === 'default') merged.removeChild(child)
  }
  const references = kids(generated).filter((child) => written.has(child.localName ?? ''))
  for (const reference of references.toReversed())
    insertBefore(merged, reference, merged.firstChild)
  const size = kid(generated, 'pgSz')
  const margins = kid(generated, 'pgMar')
  if (size && margins) {
    setSectionPage(merged, {
      width: Number(attrOf(size, 'w')),
      height: Number(attrOf(size, 'h')),
      margins: {
        top: Number(attrOf(margins, 'top')),
        right: Number(attrOf(margins, 'right')),
        bottom: Number(attrOf(margins, 'bottom')),
        left: Number(attrOf(margins, 'left')),
        header: Number(attrOf(margins, 'header')),
        footer: Number(attrOf(margins, 'footer'))
      }
    })
  }
  replaceNode(generated, merged)
}

/** Writes edited blocks, giving each the properties of the block it took the place of. */
function insertEdited(
  body: Element,
  sectPr: Element | null,
  run: readonly WriterNode[],
  xml: readonly string[],
  replaced: readonly ReplacedBlock[]
): void {
  const objectsKept = new Set<Element>()
  let lastParagraph: Element | null = null
  run.forEach((node, index) => {
    const elements = importMarkup(body, xml[index] ?? '')
    const { read, source } = replaced.at(index) ?? { read: undefined, source: null }
    const element = elements.length === 1 ? elements[0] : null
    if (element && read && isParagraph(node) && isParagraph(read) && source?.localName === 'p') {
      keepParagraphProperties(element, source, node, read)
      if (!objectsKept.has(source)) keepUnreadContent(element, source)
      objectsKept.add(source)
    }
    if (node.type === 'sectionBreak' && read?.type === 'sectionBreak') {
      // The break was written into its own paragraph, or into the paragraph before it.
      const paragraph = element ?? lastParagraph
      const generated = kid(kid(paragraph, 'pPr'), 'sectPr')
      const original = kid(kid(source, 'pPr'), 'sectPr')
      if (generated && original) keepSectionProperties(generated, original)
    }
    for (const created of elements) insertBefore(body, created, sectPr)
    const last = elements.at(-1)
    if (last) lastParagraph = last.localName === 'p' ? last : null
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
    const pairs = replacedBlocks(replaced)
    const written = run.map((node, index) => {
      const read = pairs.at(index)?.read
      return node.type === 'sectionBreak' && read?.type === 'sectionBreak'
        ? sectionToWrite(node, read)
        : node
    })
    const xml = part.eachBlock(written, textWidth)
    generated += xml.join('')
    insertEdited(body, sectPr, run, xml, pairs)
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
