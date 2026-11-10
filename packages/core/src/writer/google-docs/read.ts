import { isEqual } from 'es-toolkit'

import {
  createWriterDocument,
  defaultPageSetup,
  ptToTwips,
  type PageSetup,
  type WriterDocument,
  type WriterMark,
  type WriterNode
} from '#core/writer/model'

import type {
  GoogleColor,
  GoogleDimension,
  GoogleDocument,
  GoogleParagraph,
  GoogleStructuralElement,
  GoogleTextStyle
} from './types'

/** Reads a Google Docs API document into the document model. */

const HEADING_STYLES: Record<string, number | undefined> = {
  TITLE: 1,
  HEADING_1: 1,
  HEADING_2: 2,
  HEADING_3: 3,
  HEADING_4: 4,
  HEADING_5: 5,
  HEADING_6: 6
}

const toPt = (dimension: GoogleDimension | undefined): number | null => {
  if (dimension?.magnitude === undefined) return null
  return dimension.unit === 'EMU' ? dimension.magnitude / 12700 : dimension.magnitude
}

const hexByte = (value: number | undefined) =>
  Math.round((value ?? 0) * 255)
    .toString(16)
    .padStart(2, '0')

function colorHex(color: GoogleColor | undefined): string | null {
  const rgb = color?.color?.rgbColor
  return rgb ? `#${hexByte(rgb.red)}${hexByte(rgb.green)}${hexByte(rgb.blue)}` : null
}

export function googleMarks(style: GoogleTextStyle | undefined): WriterMark[] {
  if (!style) return []
  const marks: WriterMark[] = []
  if (style.bold) marks.push({ type: 'bold' })
  if (style.italic) marks.push({ type: 'italic' })
  if (style.underline && !style.link) marks.push({ type: 'underline' })
  if (style.strikethrough) marks.push({ type: 'strike' })
  if (style.baselineOffset === 'SUPERSCRIPT') marks.push({ type: 'superscript' })
  if (style.baselineOffset === 'SUBSCRIPT') marks.push({ type: 'subscript' })
  const attrs: Record<string, string> = {}
  const font = style.weightedFontFamily?.fontFamily
  if (font) attrs.fontFamily = font
  const size = toPt(style.fontSize)
  if (size) attrs.fontSize = `${size}pt`
  const color = colorHex(style.foregroundColor)
  if (color) attrs.color = color
  const background = colorHex(style.backgroundColor)
  if (background) attrs.backgroundColor = background
  if (Object.keys(attrs).length) marks.push({ type: 'textStyle', attrs })
  if (style.link?.url) marks.push({ type: 'link', attrs: { href: style.link.url } })
  return marks
}

/** START and END are the paragraph's own start and end edges, as Docs aligns RTL text. */
function alignment(value: string | undefined, rtl: boolean): string | null {
  switch (value) {
    case 'CENTER':
      return 'center'
    case 'JUSTIFIED':
      return 'justify'
    case 'START':
      return rtl ? 'right' : 'left'
    case 'END':
      return rtl ? 'left' : 'right'
    default:
      return null
  }
}

interface ReadState {
  source: GoogleDocument
}

function withMarks(node: WriterNode, marks: WriterMark[]): WriterNode {
  return marks.length ? { ...node, marks } : node
}

function mergeText(nodes: WriterNode[]): WriterNode[] {
  const out: WriterNode[] = []
  for (const node of nodes) {
    const last = out.at(-1)
    if (
      last?.type === 'text' &&
      node.type === 'text' &&
      isEqual(last.marks ?? [], node.marks ?? [])
    ) {
      out[out.length - 1] = { ...last, text: (last.text ?? '') + (node.text ?? '') }
    } else out.push(node)
  }
  return out
}

function inlineImage(id: string | undefined, state: ReadState): WriterNode | null {
  const embedded = id
    ? state.source.inlineObjects?.[id]?.inlineObjectProperties?.embeddedObject
    : undefined
  const src = embedded?.imageProperties?.contentUri
  if (!src) return null
  const attrs: Record<string, unknown> = { src }
  const width = toPt(embedded.size?.width)
  const height = toPt(embedded.size?.height)
  if (width) attrs.width = Math.round((width * 96) / 72)
  if (height) attrs.height = Math.round((height * 96) / 72)
  if (embedded.description) attrs.alt = embedded.description
  return { type: 'image', attrs }
}

/** A paragraph's inline content, split where page breaks fall. */
function paragraphInlines(paragraph: GoogleParagraph, state: ReadState): Array<WriterNode | null> {
  const out: Array<WriterNode | null> = []
  for (const element of paragraph.elements ?? []) {
    if (element.textRun) {
      const marks = googleMarks(element.textRun.textStyle)
      // Docs ends every paragraph with a newline, and writes line breaks as vertical tabs.
      const parts = (element.textRun.content ?? '').replace(/\n$/, '').split('\u000b')
      parts.forEach((part, index) => {
        if (index > 0) out.push({ type: 'hardBreak' })
        if (part) out.push(withMarks({ type: 'text', text: part }, marks))
      })
    } else if (
      element.autoText?.type === 'PAGE_NUMBER' ||
      element.autoText?.type === 'PAGE_COUNT'
    ) {
      const type = element.autoText.type === 'PAGE_NUMBER' ? 'pageNumber' : 'pageCount'
      out.push(withMarks({ type }, googleMarks(element.autoText.textStyle)))
    } else if (element.pageBreak) out.push(null)
    else if (element.inlineObjectElement) {
      const image = inlineImage(element.inlineObjectElement.inlineObjectId, state)
      if (image) out.push(image)
    }
  }
  return out
}

interface ListInfo {
  listId: string
  level: number
  ordered: boolean
  start: number
}

interface Block {
  node: WriterNode
  list?: ListInfo
}

/** Which list a bulleted paragraph is in; a glyph symbol means bullets, a glyph type numbers. */
function listInfo(paragraph: GoogleParagraph, state: ReadState): ListInfo | undefined {
  const listId = paragraph.bullet?.listId
  if (!listId) return undefined
  const nesting = paragraph.bullet?.nestingLevel ?? 0
  const glyph = state.source.lists?.[listId]?.listProperties?.nestingLevels?.[nesting]
  const ordered = Boolean(
    glyph?.glyphType && glyph.glyphType !== 'GLYPH_TYPE_UNSPECIFIED' && !glyph.glyphSymbol
  )
  return { listId, level: nesting, ordered, start: glyph?.startNumber ?? 1 }
}

function readParagraph(paragraph: GoogleParagraph, state: ReadState): Block[] {
  const style = paragraph.paragraphStyle
  const rtl = style?.direction === 'RIGHT_TO_LEFT'
  const attrs: Record<string, unknown> = { dir: rtl ? 'rtl' : 'ltr' }
  const align = alignment(style?.alignment, rtl)
  if (align) attrs.textAlign = align
  const level = HEADING_STYLES[style?.namedStyleType ?? '']
  const make = (content: WriterNode[]): WriterNode => {
    const node: WriterNode = level
      ? { type: 'heading', attrs: { ...attrs, level } }
      : { type: 'paragraph', attrs: { ...attrs } }
    const merged = mergeText(content)
    return merged.length ? { ...node, content: merged } : node
  }
  const list = listInfo(paragraph, state)
  const blocks: Block[] = []
  let current: WriterNode[] = []
  let broke = false
  for (const item of paragraphInlines(paragraph, state)) {
    if (item === null) {
      if (current.length) blocks.push({ node: make(current), list })
      blocks.push({ node: { type: 'pageBreak' } })
      current = []
      broke = true
    } else current.push(item)
  }
  if (current.length || !broke) blocks.push({ node: make(current), list })
  return blocks
}

function readTable(element: GoogleStructuralElement, state: ReadState): WriterNode {
  const rows = (element.table?.tableRows ?? []).map((row) => {
    const cells: WriterNode[] = []
    for (const cell of row.tableCells ?? []) {
      const rowspan = cell.tableCellStyle?.rowSpan ?? 1
      const colspan = cell.tableCellStyle?.columnSpan ?? 1
      // Docs lists the cells a merge covers with zero spans; the model leaves them out.
      if (rowspan === 0 || colspan === 0) continue
      const content = readElements(cell.content ?? [], state)
      cells.push({
        type: 'tableCell',
        attrs: { colspan, rowspan, colwidth: null },
        content: content.length ? content : [{ type: 'paragraph' }]
      })
    }
    return { type: 'tableRow', content: cells }
  })
  return { type: 'table', content: rows }
}

/** Groups list paragraphs into nested lists, as the Word reader does. */
function buildLists(blocks: readonly Block[]): WriterNode[] {
  const out: WriterNode[] = []
  const stack: Array<{ list: WriterNode; level: number; id: string }> = []
  for (const block of blocks) {
    const info = block.list
    if (!info) {
      stack.length = 0
      out.push(block.node)
      continue
    }
    while (stack.length && (stack.at(-1)?.level ?? 0) > info.level) stack.pop()
    let top = stack.at(-1)
    if (top?.level === info.level && top.id !== info.listId) {
      stack.pop()
      top = stack.at(-1)
    }
    if (!top || top.level < info.level) {
      const list: WriterNode = info.ordered
        ? { type: 'orderedList', attrs: { start: info.start }, content: [] }
        : { type: 'bulletList', content: [] }
      const parent = top?.list.content?.at(-1)
      if (parent) parent.content = [...(parent.content ?? []), list]
      else out.push(list)
      stack.push({ list, level: info.level, id: info.listId })
      top = stack.at(-1)
    }
    top?.list.content?.push({ type: 'listItem', content: [block.node] })
  }
  return out
}

function readElements(
  elements: readonly GoogleStructuralElement[],
  state: ReadState
): WriterNode[] {
  const blocks: Block[] = []
  for (const element of elements) {
    if (element.paragraph) blocks.push(...readParagraph(element.paragraph, state))
    else if (element.table) blocks.push({ node: readTable(element, state) })
    else if (element.tableOfContents) blocks.push({ node: { type: 'tableOfContents' } })
  }
  return buildLists(blocks)
}

function readPage(source: GoogleDocument): PageSetup {
  const page = defaultPageSetup()
  const style = source.documentStyle
  const twips = (dimension: GoogleDimension | undefined, fallback: number) => {
    const pt = toPt(dimension)
    return pt === null ? fallback : ptToTwips(pt)
  }
  return {
    width: twips(style?.pageSize?.width, page.width),
    height: twips(style?.pageSize?.height, page.height),
    margins: {
      top: twips(style?.marginTop, page.margins.top),
      right: twips(style?.marginRight, page.margins.right),
      bottom: twips(style?.marginBottom, page.margins.bottom),
      left: twips(style?.marginLeft, page.margins.left),
      header: twips(style?.marginHeader, page.margins.header),
      footer: twips(style?.marginFooter, page.margins.footer)
    }
  }
}

function region(content: readonly GoogleStructuralElement[] | undefined, state: ReadState) {
  if (!content) return null
  const nodes = readElements(content, state).filter(
    (node) => !(node.type === 'paragraph' && !node.content?.length)
  )
  return nodes.length ? { type: 'doc', content: nodes } : null
}

export function readGoogleDocument(source: GoogleDocument): WriterDocument {
  const state: ReadState = { source }
  const content = readElements(source.body?.content ?? [], state)
  const style = source.documentStyle
  const header = style?.defaultHeaderId ? source.headers?.[style.defaultHeaderId] : undefined
  const footer = style?.defaultFooterId ? source.footers?.[style.defaultFooterId] : undefined
  return createWriterDocument({
    body: { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] },
    page: readPage(source),
    header: region(header?.content, state),
    footer: region(footer?.content, state),
    title: source.title ?? ''
  })
}
