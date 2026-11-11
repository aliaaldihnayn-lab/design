import type { Element } from '@xmldom/xmldom'
import { unzipSync } from 'fflate'

import { buildLists, type ListedBlock, type ListPlace } from '#core/writer/lists'
import {
  createWriterDocument,
  defaultPageSetup,
  mergeText,
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
  type PackageFiles,
  type ReadContext
} from './context'
import { readInlines, type InlineState } from './inline'
import {
  documentDefaults,
  effectiveParagraph,
  readParagraphProperties,
  type ParagraphProperties
} from './styles'
import { attrOf, find, kid, kids, parseXML, toggleOf, valOf } from './xml'

const TWIPS_PER_PX = 15

export class DocxReadError extends Error {
  override name = 'DocxReadError'
}

/** Styles Word gives text by its role, which the model keeps as structure instead. */
const ROLE_PARAGRAPH_STYLES = new Set([
  'footnote text',
  'endnote text',
  'annotation text',
  'header',
  'footer',
  'title'
])

function headingLevel(styleId: string | null, context: ReadContext): number | null {
  if (!styleId) return null
  const name = context.styles.names.get(styleId) ?? styleId.toLowerCase()
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

/** The list a numbered paragraph is an item of, from its own numbering or its style's. */
function listOf(props: ParagraphProperties, context: ReadContext): ListPlace | undefined {
  const numId = props.numId
  if (!numId || numId === '0') return undefined
  const level = props.ilvl ?? 0
  const info = context.numbering.levels.get(numId)?.[level]
  return info ? { id: numId, level, ordered: info.ordered, start: info.start } : undefined
}

function readParagraph(p: Element, state: InlineState): ListedBlock[] {
  const { context } = state
  const pPr = kid(p, 'pPr')
  const sheet = context.styles
  const styleId = valOf(pPr, 'pStyle') ?? sheet.defaultParagraphStyle
  const props = effectiveParagraph(sheet, styleId, readParagraphProperties(pPr))
  const rtl = props.bidi === true
  const attrs: Record<string, unknown> = { dir: rtl ? 'rtl' : 'ltr' }
  const align = readAlignment(props.jc ?? null, rtl)
  if (align) attrs.textAlign = align
  const level = headingLevel(valOf(pPr, 'pStyle'), context)
  // A heading's or a footnote's look is the editor's for that role; its runs inherit only
  // what plain text would.
  const role = level !== null || ROLE_PARAGRAPH_STYLES.has(sheet.names.get(styleId ?? '') ?? '')
  state.paragraphStyle = role ? sheet.defaultParagraphStyle : styleId
  const make = (content: WriterNode[]): WriterNode => {
    const merged = mergeText(content)
    const node: WriterNode =
      level !== null
        ? { type: 'heading', attrs: { ...attrs, level } }
        : { type: 'paragraph', attrs: { ...attrs } }
    return merged.length ? { ...node, content: merged } : node
  }
  const list = listOf(props, context)

  const items = readInlines(p, state, [])
  const blocks: ListedBlock[] = []
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
  state.paragraphStyle = null
  const sectPr = kid(pPr, 'sectPr')
  if (sectPr) {
    const attrs: Record<string, unknown> = { page: readSection(sectPr) }
    // A section without a reference keeps the previous section's; `inheritRegions` fills it.
    for (const kind of ['header', 'footer'] as const) {
      const region = readHeaderFooter(state.context, sectPr, `${kind}Reference`)
      if (region) attrs[kind] = region.node.content?.length ? region.node : null
    }
    blocks.push({ node: { type: 'sectionBreak', attrs } })
  }
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

/** Body blocks, and the top-level elements each was read from, for patching a package. */
export interface SourcedBlock {
  node: WriterNode
  sources: Element[]
}

function countItems(node: WriterNode): number {
  if (node.type === 'listItem') {
    return 1 + (node.content ?? []).reduce((sum, child) => sum + countItems(child), 0)
  }
  return (node.content ?? []).reduce((sum, child) => sum + countItems(child), 0)
}

export function readSourcedBlocks(parent: Element, state: InlineState): SourcedBlock[] {
  const items: Array<ListedBlock & { owner: Element }> = []
  const visit = (container: Element, owner: Element | null) => {
    for (const child of kids(container)) {
      const top = owner ?? child
      if (child.localName === 'p' && /^toc/i.test(valOf(kid(child, 'pPr'), 'pStyle') ?? '')) {
        if (items.at(-1)?.node.type !== 'tableOfContents') {
          items.push({ node: { type: 'tableOfContents' }, owner: top })
        }
      } else if (child.localName === 'p') {
        items.push(...readParagraph(child, state).map((item) => ({ ...item, owner: top })))
      } else if (child.localName === 'tbl')
        items.push({ node: readTable(child, state), owner: top })
      else if (child.localName === 'sdt') {
        const content = kid(child, 'sdtContent')
        const gallery =
          valOf(find(child, 'docPartGallery'), 'docPartGallery') ??
          attrOf(find(child, 'docPartGallery'), 'val')
        if (gallery === 'Table of Contents') {
          items.push({ node: { type: 'tableOfContents' }, owner: top })
        } else if (content) visit(content, top)
      } else if (child.localName === 'customXml') visit(child, top)
    }
  }
  visit(parent, null)
  const blocks = buildLists(items)
  // A list consumed one item per list item in it; any other block, one item.
  let index = 0
  return blocks.map((node) => {
    const used = node.type === 'bulletList' || node.type === 'orderedList' ? countItems(node) : 1
    const owners = items.slice(index, index + used).map((item) => item.owner)
    index += used
    return { node, sources: owners.filter((owner, at) => owners.indexOf(owner) === at) }
  })
}

function readBlocks(parent: Element, state: InlineState): WriterNode[] {
  return readSourcedBlocks(parent, state).map((block) => block.node)
}

export function readSection(sectPr: Element | null): PageSetup {
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

/** A package opened for reading: its parts, its main part's XML, and what reading it needs. */
export interface OpenedDocx {
  files: PackageFiles
  documentPath: string
  root: Element
  body: Element
  context: ReadContext
}

export function openDocx(bytes: Uint8Array): OpenedDocx {
  if (!ZIP_MAGIC.every((byte, index) => bytes[index] === byte)) {
    throw new DocxReadError(isEncryptedOffice(bytes) ? 'encrypted' : 'not-docx')
  }
  const files = unzipSync(bytes)
  const rootRels = readRels(files, '')
  const officeDocument = [...rootRels.values()].find((rel) => rel.type.endsWith('/officeDocument'))
  const documentPath = officeDocument ? resolvePath('', officeDocument.target) : 'word/document.xml'
  const root = parseXML(readText(files, documentPath) ?? '')
  const body = kid(root, 'body')
  if (!root || !body) throw new DocxReadError('not-docx')
  const base: ReadContext = {
    files,
    rels: new Map(),
    base: '',
    styles: readStyles(files),
    numbering: readNumbering(files)
  }
  return { files, documentPath, root, body, context: partContext(base, documentPath) }
}

export const newInlineState = (context: ReadContext): InlineState => ({
  context,
  comments: [],
  field: null
})

/**
 * Gives each section break the header and footer Word shows in it: a section with no reference
 * of its own continues the one before (ECMA-376 17.10.5). Returns what the last break had, for
 * the document's own section.
 */
function inheritRegions(content: WriterNode[]): Record<'header' | 'footer', WriterNode | null> {
  const current: Record<'header' | 'footer', WriterNode | null> = { header: null, footer: null }
  for (const node of content) {
    if (node.type !== 'sectionBreak') continue
    const attrs = { ...node.attrs }
    for (const kind of ['header', 'footer'] as const) {
      if (kind in attrs) current[kind] = (attrs[kind] as WriterNode | null) ?? null
      else attrs[kind] = current[kind]
    }
    node.attrs = attrs
  }
  return current
}

/** Reads a Word `.docx` package into the model. */
export function readDocx(bytes: Uint8Array): WriterDocument {
  const { files, body, context } = openDocx(bytes)
  const content = readBlocks(body, newInlineState(context))
  const sectPr = kid(body, 'sectPr')
  const inherited = inheritRegions(content)
  const header = readHeaderFooter(context, sectPr, 'headerReference')
  const footer = readHeaderFooter(context, sectPr, 'footerReference')
  const lastRegion = (
    kind: 'header' | 'footer',
    read: { node: WriterNode } | null
  ): WriterNode | null => {
    if (read) return read.node.content?.length ? read.node : null
    return inherited[kind]
  }
  const settings = parseXML(readText(files, 'word/settings.xml') ?? '')
  const core = parseXML(readText(files, 'docProps/core.xml') ?? '')
  const title = find(core, 'title')?.textContent ?? ''

  return createWriterDocument({
    body: { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] },
    page: readSection(sectPr),
    header: lastRegion('header', header),
    footer: lastRegion('footer', footer),
    watermark: header?.watermark ? { text: header.watermark } : null,
    comments: readComments(files),
    footnotes: readFootnotes(context),
    trackChanges: toggleOf(settings, 'trackRevisions') === true,
    title,
    defaults: documentDefaults(context.styles)
  })
}
