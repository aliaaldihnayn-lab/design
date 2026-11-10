import type { Element } from '@xmldom/xmldom'
import { unzipSync } from 'fflate'

import {
  createWriterDocument,
  defaultPageSetup,
  type PageSetup,
  type WriterComment,
  type WriterDocument,
  type WriterFootnote,
  type WriterNode
} from '#core/writer/model'

import {
  partContext,
  readNumbering,
  readRels,
  readStyles,
  readText,
  resolvePath,
  type BlockItem,
  type PackageFiles,
  type ListInfo,
  type ReadContext
} from './context'
import { mergeText, readInlines, type InlineState } from './inline'
import { attrOf, find, kid, kids, parseXML, toggleOf, valOf } from './xml'

const TWIPS_PER_PX = 15

export class DocxReadError extends Error {
  override name = 'DocxReadError'
}

function headingLevel(styleId: string | null, context: ReadContext): number | null {
  if (!styleId) return null
  const name = context.styles.get(styleId) ?? styleId.toLowerCase()
  const match = /^heading\s*(\d)$/.exec(name) ?? /^heading(\d)$/i.exec(styleId)
  if (match) return Math.min(6, Number(match[1]))
  if (name === 'title') return 1
  return null
}

function readAlignment(jc: string | null, rtl: boolean): string | null {
  switch (jc) {
    case 'center':
      return 'center'
    case 'both':
    case 'distribute':
      return 'justify'
    case 'left':
      return rtl ? 'right' : 'left'
    case 'right':
      return rtl ? 'left' : 'right'
    case 'start':
      return rtl ? 'right' : 'left'
    case 'end':
      return rtl ? 'left' : 'right'
    default:
      return null
  }
}

function readParagraph(p: Element, state: InlineState): BlockItem[] {
  const { context } = state
  const pPr = kid(p, 'pPr')
  const bidi = toggleOf(pPr, 'bidi')
  const rtl = bidi === true
  const attrs: Record<string, unknown> = { dir: rtl ? 'rtl' : 'ltr' }
  const align = readAlignment(valOf(pPr, 'jc'), rtl)
  if (align) attrs.textAlign = align
  const level = headingLevel(valOf(pPr, 'pStyle'), context)
  const make = (content: WriterNode[]): WriterNode => {
    const merged = mergeText(content)
    const node: WriterNode =
      level !== null
        ? { type: 'heading', attrs: { ...attrs, level } }
        : { type: 'paragraph', attrs: { ...attrs } }
    return merged.length ? { ...node, content: merged } : node
  }
  let list: ListInfo | undefined
  const numPr = kid(pPr, 'numPr')
  const numId = valOf(numPr, 'numId')
  if (numId && numId !== '0') {
    const ilvl = Number(valOf(numPr, 'ilvl') ?? 0)
    const levels = context.numbering.levels.get(numId)
    const info = levels?.[ilvl]
    if (info) list = { numId, level: ilvl, ordered: info.ordered, start: info.start }
  }

  const items = readInlines(p, state, [])
  const blocks: BlockItem[] = []
  let current: WriterNode[] = []
  let sawBreak = false
  for (const item of items) {
    if (item.type === '__pageBreak') {
      if (current.length) blocks.push({ node: make(current), list })
      blocks.push({ node: { type: 'pageBreak' } })
      current = []
      sawBreak = true
    } else current.push(item)
  }
  if (current.length || !sawBreak)
    blocks.push({ node: make(current), list: current.length || !sawBreak ? list : undefined })
  return blocks
}

function readTable(tbl: Element, state: InlineState): WriterNode {
  const grid = kids(kid(tbl, 'tblGrid'), 'gridCol').map((col) => Number(attrOf(col, 'w') ?? 0))
  const rows: WriterNode[] = []
  /** Cells whose `vMerge` continues down, by grid column. */
  const open = new Map<number, WriterNode>()
  for (const tr of kids(tbl, 'tr')) {
    const header = toggleOf(kid(tr, 'trPr'), 'tblHeader') === true
    const cells: WriterNode[] = []
    let column = Number(valOf(kid(tr, 'trPr'), 'gridBefore') ?? 0)
    for (const tc of kids(tr, 'tc')) {
      const tcPr = kid(tc, 'tcPr')
      const span = Number(valOf(tcPr, 'gridSpan') ?? 1)
      const merge = kid(tcPr, 'vMerge')
      const mergeValue = attrOf(merge, 'val')
      if (merge && mergeValue !== 'restart') {
        const above = open.get(column)
        if (above?.attrs) above.attrs.rowspan = Number(above.attrs.rowspan ?? 1) + 1
        column += span
        continue
      }
      const widths = grid.slice(column, column + span)
      const attrs: Record<string, unknown> = { colspan: span, rowspan: 1 }
      if (widths.length === span && widths.every((width) => width > 0)) {
        attrs.colwidth = widths.map((width) => Math.round(width / TWIPS_PER_PX))
      } else attrs.colwidth = null
      const fill = attrOf(kid(tcPr, 'shd'), 'fill')
      if (fill && /^[0-9a-f]{6}$/i.test(fill)) attrs.background = `#${fill.toLowerCase()}`
      const content = readBlocks(tc, state)
      const cell: WriterNode = {
        type: header ? 'tableHeader' : 'tableCell',
        attrs,
        content: content.length ? content : [{ type: 'paragraph' }]
      }
      if (merge) open.set(column, cell)
      else open.delete(column)
      cells.push(cell)
      column += span
    }
    rows.push({ type: 'tableRow', content: cells })
  }
  // A right-to-left table puts its first column on the right.
  const dir = toggleOf(kid(tbl, 'tblPr'), 'bidiVisual') ? 'rtl' : 'ltr'
  return { type: 'table', attrs: { dir }, content: rows }
}

/** Groups numbered paragraphs into nested lists. */
function buildLists(items: readonly BlockItem[]): WriterNode[] {
  const out: WriterNode[] = []
  const stack: Array<{ list: WriterNode; level: number; numId: string }> = []
  for (const item of items) {
    const info = item.list
    if (!info) {
      stack.length = 0
      out.push(item.node)
      continue
    }
    while (stack.length && (stack.at(-1)?.level ?? 0) > info.level) stack.pop()
    let top = stack.at(-1)
    if (
      top &&
      top.level === info.level &&
      (top.numId !== info.numId || isOrdered(top.list) !== info.ordered)
    ) {
      stack.pop()
      top = stack.at(-1)
    }
    if (!top || top.level < info.level) {
      const list: WriterNode = info.ordered
        ? { type: 'orderedList', attrs: { start: info.start }, content: [] }
        : { type: 'bulletList', content: [] }
      const parentItem = top?.list.content?.at(-1)
      if (parentItem) parentItem.content = [...(parentItem.content ?? []), list]
      else out.push(list)
      stack.push({ list, level: info.level, numId: info.numId })
      top = stack.at(-1)
    }
    top?.list.content?.push({ type: 'listItem', content: [item.node] })
  }
  return out
}

const isOrdered = (list: WriterNode) => list.type === 'orderedList'

function readBlocks(parent: Element, state: InlineState): WriterNode[] {
  const items: BlockItem[] = []
  const visit = (container: Element) => {
    for (const child of kids(container)) {
      if (child.localName === 'p' && /^toc/i.test(valOf(kid(child, 'pPr'), 'pStyle') ?? '')) {
        if (items.at(-1)?.node.type !== 'tableOfContents') {
          items.push({ node: { type: 'tableOfContents' } })
        }
      } else if (child.localName === 'p') items.push(...readParagraph(child, state))
      else if (child.localName === 'tbl') items.push({ node: readTable(child, state) })
      else if (child.localName === 'sdt') {
        const content = kid(child, 'sdtContent')
        const gallery =
          valOf(find(child, 'docPartGallery'), 'docPartGallery') ??
          attrOf(find(child, 'docPartGallery'), 'val')
        if (gallery === 'Table of Contents') items.push({ node: { type: 'tableOfContents' } })
        else if (content) visit(content)
      } else if (child.localName === 'customXml') visit(child)
    }
  }
  visit(parent)
  return buildLists(items)
}

function readSection(sectPr: Element | null): PageSetup {
  const page = defaultPageSetup()
  const size = kid(sectPr, 'pgSz')
  const margins = kid(sectPr, 'pgMar')
  const num = (element: Element | null, name: string, fallback: number) => {
    const value = Number(attrOf(element, name))
    return Number.isFinite(value) && attrOf(element, name) !== null
      ? Math.abs(Math.round(value))
      : fallback
  }
  return {
    width: num(size, 'w', page.width),
    height: num(size, 'h', page.height),
    margins: {
      top: num(margins, 'top', page.margins.top),
      right: num(margins, 'right', page.margins.right),
      bottom: num(margins, 'bottom', page.margins.bottom),
      left: num(margins, 'left', page.margins.left),
      header: num(margins, 'header', page.margins.header),
      footer: num(margins, 'footer', page.margins.footer)
    }
  }
}

function readHeaderFooter(
  context: ReadContext,
  sectPr: Element | null,
  kind: 'headerReference' | 'footerReference'
): { node: WriterNode; watermark: string | null } | null {
  const references = kids(sectPr, kind)
  const reference = references.find((ref) => attrOf(ref, 'type') === 'default') ?? references[0]
  const rid = attrOf(reference, 'id')
  const rel = rid ? context.rels.get(rid) : undefined
  if (!rel) return null
  const path = resolvePath(context.base, rel.target)
  const root = parseXML(readText(context.files, path) ?? '')
  if (!root) return null
  const watermark = attrOf(find(root, 'textpath'), 'string')
  const state: InlineState = { context: partContext(context, path), comments: [], field: null }
  const content = readBlocks(root, state).filter(
    (node) => !(node.type === 'paragraph' && !node.content?.length)
  )
  return { node: { type: 'doc', content }, watermark }
}

/** Paragraph ids of resolved comments, from Word 2013's comments extension part. */
function resolvedParagraphs(files: PackageFiles): Set<string> {
  const root = parseXML(readText(files, 'word/commentsExtended.xml') ?? '')
  const done = kids(root, 'commentEx').filter((entry) => attrOf(entry, 'done') === '1')
  return new Set(done.map((entry) => attrOf(entry, 'paraId') ?? ''))
}

function readComments(files: PackageFiles): WriterComment[] {
  const root = parseXML(readText(files, 'word/comments.xml') ?? '')
  const resolved = resolvedParagraphs(files)
  return kids(root, 'comment').map((comment) => {
    const paragraphs = kids(comment, 'p')
    const entry: WriterComment = {
      id: `c${attrOf(comment, 'id') ?? ''}`,
      author: attrOf(comment, 'author') ?? '',
      date: attrOf(comment, 'date') ?? '',
      text: paragraphs.map((p) => p.textContent ?? '').join('\n')
    }
    const initials = attrOf(comment, 'initials')
    if (initials) entry.initials = initials
    if (resolved.has(attrOf(paragraphs.at(-1), 'paraId') ?? '')) entry.resolved = true
    return entry
  })
}

function readFootnotes(context: ReadContext): WriterFootnote[] {
  const path = 'word/footnotes.xml'
  const root = parseXML(readText(context.files, path) ?? '')
  if (!root) return []
  const state: InlineState = { context: partContext(context, path), comments: [], field: null }
  return kids(root, 'footnote')
    .filter((note) => !attrOf(note, 'type') || attrOf(note, 'type') === 'normal')
    .map((note) => ({
      id: `fn${attrOf(note, 'id') ?? ''}`,
      content: readBlocks(note, state).map((block) => trimLeadingSpace(block))
    }))
}

/** Word puts a space after a footnote's own number; the model keeps the text only. */
function trimLeadingSpace(block: WriterNode): WriterNode {
  const first = block.content?.[0]
  if (first?.type !== 'text' || !first.text?.startsWith(' ')) return block
  const text = first.text.slice(1)
  const rest = block.content?.slice(1) ?? []
  return { ...block, content: text ? [{ ...first, text }, ...rest] : rest }
}

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]
const CFB_MAGIC = [0xd0, 0xcf, 0x11, 0xe0]

/** Whether the bytes are an encrypted Office file (a compound file, not a zip). */
export function isEncryptedOffice(bytes: Uint8Array): boolean {
  return CFB_MAGIC.every((byte, index) => bytes[index] === byte)
}

/** Reads a Word `.docx` package into the model model. */
export function readDocx(bytes: Uint8Array): WriterDocument {
  if (!ZIP_MAGIC.every((byte, index) => bytes[index] === byte)) {
    throw new DocxReadError(isEncryptedOffice(bytes) ? 'encrypted' : 'not-docx')
  }
  const files = unzipSync(bytes)
  const rootRels = readRels(files, '')
  const officeDocument = [...rootRels.values()].find((rel) => rel.type.endsWith('/officeDocument'))
  const documentPath = officeDocument ? resolvePath('', officeDocument.target) : 'word/document.xml'
  const root = parseXML(readText(files, documentPath) ?? '')
  const body = kid(root, 'body')
  if (!body) throw new DocxReadError('not-docx')

  const base: ReadContext = {
    files,
    rels: new Map(),
    base: '',
    styles: readStyles(files),
    numbering: readNumbering(files)
  }
  const context = partContext(base, documentPath)
  const state: InlineState = { context, comments: [], field: null }
  const content = readBlocks(body, state)
  const sectPr = kid(body, 'sectPr')
  const header = readHeaderFooter(context, sectPr, 'headerReference')
  const footer = readHeaderFooter(context, sectPr, 'footerReference')
  const settings = parseXML(readText(files, 'word/settings.xml') ?? '')
  const core = parseXML(readText(files, 'docProps/core.xml') ?? '')
  const title = find(core, 'title')?.textContent ?? ''

  return createWriterDocument({
    body: { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] },
    page: readSection(sectPr),
    header: header?.node.content?.length ? header.node : null,
    footer: footer?.node.content?.length ? footer.node : null,
    watermark: header?.watermark ? { text: header.watermark } : null,
    comments: readComments(files),
    footnotes: readFootnotes(context),
    trackChanges: toggleOf(settings, 'trackRevisions') === true,
    title
  })
}
