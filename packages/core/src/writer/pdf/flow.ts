import { fontSizePt } from '#core/writer/docx/runs'
import { footnoteNumbers } from '#core/writer/footnotes'
import {
  detectDirection,
  hasMark,
  markAttr,
  nodeText,
  numberAttr,
  stringAttr,
  type PageSetup,
  type WriterDefaults,
  type WriterNode
} from '#core/writer/model'
import { sectionPage } from '#core/writer/sections'

/**
 * The document as the PDF lays it out: blocks of styled runs in reading order, list markers and
 * indents resolved, with the sizes and spacing the editor and print styles give each kind of
 * block, so the PDF looks like the page in the editor.
 */

export interface RunStyle {
  family: string
  /** Points. */
  size: number
  bold: boolean
  italic: boolean
  underline: boolean
  strike: boolean
  /** CSS colour. */
  color: string
  background: string | null
  script: 'super' | 'sub' | null
  link: string | null
}

export type InlineRun =
  | { kind: 'text'; text: string; style: RunStyle }
  | { kind: 'image'; src: string; width: number; height: number; style: RunStyle }
  | { kind: 'field'; field: 'pageNumber' | 'pageCount'; style: RunStyle }

export type TextAlignment = 'start' | 'end' | 'left' | 'right' | 'center' | 'justify'

export interface ParagraphBlock {
  kind: 'paragraph'
  runs: InlineRun[]
  rtl: boolean
  align: TextAlignment
  /** Points, from the start edge. */
  indent: number
  spaceBefore: number
  spaceAfter: number
  /** Line height as a multiple of the font size. */
  leading: number
  marker: string | null
  /** A heading's level, for a table of contents. */
  heading: number | null
  /** Placeholder for a table of contents to fill once pages are known. */
  toc?: boolean
}

export interface TableCell {
  blocks: FlowBlock[]
  colspan: number
  header: boolean
  background: string | null
}

export interface TableBlock {
  kind: 'table'
  rtl: boolean
  rows: TableCell[][]
  /** Column widths as fractions of the table width, from the cells' widths where they set them. */
  columns: number[]
}

export type FlowBlock =
  | ParagraphBlock
  | TableBlock
  | { kind: 'pageBreak' }
  | { kind: 'sectionBreak'; page: PageSetup | null }

export interface FlowContext {
  defaults: Required<Pick<WriterDefaults, 'fontFamily' | 'fontSize'>> & WriterDefaults
  footnotes: Map<string, number>
}

const spaceAfterBody = (inList: boolean) => (inList ? 0 : PARAGRAPH_AFTER)

const HEADING_SIZES = [16, 13, 12, 11, 11, 11]
const HEADING_SPACE_BEFORE = [18, 12, 12, 10, 10, 10]
const LIST_INDENT = 18
const PARAGRAPH_AFTER = 8

export function flowContext(body: WriterNode, defaults?: WriterDefaults | null): FlowContext {
  return {
    defaults: { fontFamily: 'Calibri', fontSize: 11, ...defaults },
    footnotes: footnoteNumbers(body)
  }
}

function baseStyle(context: FlowContext, rtl: boolean): RunStyle {
  const { defaults } = context
  return {
    family: (rtl ? defaults.fontFamilyComplex : undefined) ?? defaults.fontFamily,
    size: (rtl ? defaults.fontSizeComplex : undefined) ?? defaults.fontSize,
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    color: '#000000',
    background: null,
    script: null,
    link: null
  }
}

function firstFamily(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  return (
    value
      .split(',')[0]
      ?.trim()
      .replace(/^["']|["']$/g, '') ?? null
  )
}

function styleOf(node: WriterNode, base: RunStyle): RunStyle {
  const style = { ...base }
  if (hasMark(node, 'bold')) style.bold = true
  if (hasMark(node, 'italic')) style.italic = true
  if (hasMark(node, 'underline')) style.underline = true
  if (hasMark(node, 'strike')) style.strike = true
  if (hasMark(node, 'superscript')) style.script = 'super'
  if (hasMark(node, 'subscript')) style.script = 'sub'
  const family = firstFamily(markAttr(node, 'textStyle', 'fontFamily'))
  if (family) style.family = family
  const size = fontSizePt(markAttr(node, 'textStyle', 'fontSize'))
  if (size) style.size = size
  const color = markAttr(node, 'textStyle', 'color')
  if (typeof color === 'string' && color) style.color = color
  const background = markAttr(node, 'textStyle', 'backgroundColor')
  if (typeof background === 'string' && background) style.background = background
  if (hasMark(node, 'highlight')) {
    const highlight = markAttr(node, 'highlight', 'color')
    style.background = typeof highlight === 'string' && highlight ? highlight : '#ffff00'
  }
  const link = markAttr(node, 'link', 'href')
  if (typeof link === 'string' && link) {
    style.link = link
    style.color = '#0563c1'
    style.underline = true
  }
  return style
}

/** What a fillable field prints: a checkbox's box, a filled value, or a line to write on. */
function formFieldText(node: WriterNode): string {
  if (stringAttr(node.attrs, 'kind') === 'checkbox') return node.attrs?.checked ? '☒' : '☐'
  return stringAttr(node.attrs, 'value') ?? `____ ${stringAttr(node.attrs, 'name') ?? ''}`
}

function imageRun(node: WriterNode, style: RunStyle): InlineRun | null {
  const src = stringAttr(node.attrs, 'src')
  if (!src) return null
  const width = numberAttr(node.attrs, 'width') ?? 200
  const height = numberAttr(node.attrs, 'height') ?? width * 0.66
  // The editor sizes images in CSS pixels, 0.75 points each.
  return { kind: 'image', src, width: width * 0.75, height: height * 0.75, style }
}

/** A paragraph's runs; deleted tracked text is left out, as print leaves it out. */
function inlineRuns(nodes: readonly WriterNode[], base: RunStyle, context: FlowContext) {
  const runs: InlineRun[] = []
  for (const node of nodes) {
    if (hasMark(node, 'deletion')) continue
    const style = styleOf(node, base)
    switch (node.type) {
      case 'text':
        if (node.text) runs.push({ kind: 'text', text: node.text, style })
        break
      case 'hardBreak':
        runs.push({ kind: 'text', text: '\n', style })
        break
      case 'pageNumber':
      case 'pageCount':
        runs.push({ kind: 'field', field: node.type, style })
        break
      case 'footnote': {
        const number = context.footnotes.get(stringAttr(node.attrs, 'id') ?? '')
        if (number !== undefined) {
          runs.push({ kind: 'text', text: String(number), style: { ...style, script: 'super' } })
        }
        break
      }
      case 'formField':
        runs.push({ kind: 'text', text: formFieldText(node), style })
        break
      case 'image': {
        const image = imageRun(node, style)
        if (image) runs.push(image)
        break
      }
      default:
        if (node.content) runs.push(...inlineRuns(node.content, style, context))
    }
  }
  return runs
}

function directionOf(node: WriterNode, fallback: boolean): boolean {
  const dir = stringAttr(node.attrs, 'dir')
  if (dir === 'rtl') return true
  if (dir === 'ltr') return false
  return (detectDirection(nodeText(node)) ?? (fallback ? 'rtl' : 'ltr')) === 'rtl'
}

function alignmentOf(node: WriterNode): TextAlignment {
  const align = stringAttr(node.attrs, 'textAlign')
  return align === 'left' || align === 'right' || align === 'center' || align === 'justify'
    ? align
    : 'start'
}

function paragraph(
  node: WriterNode,
  context: FlowContext,
  extra: { indent: number; marker: string | null; inList: boolean; rtl: boolean }
): ParagraphBlock {
  const rtl = directionOf(node, extra.rtl)
  const level =
    node.type === 'heading' ? Math.min(6, Math.max(1, numberAttr(node.attrs, 'level') ?? 1)) : null
  const base = baseStyle(context, rtl)
  if (level !== null) {
    base.size = HEADING_SIZES[level - 1] ?? 11
    base.bold = true
  }
  return {
    kind: 'paragraph',
    runs: inlineRuns(node.content ?? [], base, context),
    rtl,
    align: alignmentOf(node),
    indent: extra.indent,
    spaceBefore: level !== null ? (HEADING_SPACE_BEFORE[level - 1] ?? 10) : 0,
    spaceAfter: level === null ? spaceAfterBody(extra.inList) : 4,
    leading: 1.4,
    marker: extra.marker,
    heading: level
  }
}

const ROMAN: Array<[number, string]> = [
  [1000, 'm'],
  [900, 'cm'],
  [500, 'd'],
  [400, 'cd'],
  [100, 'c'],
  [90, 'xc'],
  [50, 'l'],
  [40, 'xl'],
  [10, 'x'],
  [9, 'ix'],
  [5, 'v'],
  [4, 'iv'],
  [1, 'i']
]

/** A list item's marker as the editor's lists number them, by nesting depth. */
export function listMarker(ordered: boolean, number: number, depth: number): string {
  if (!ordered) return ['•', '◦', '▪'][depth % 3] ?? '•'
  if (depth % 3 === 1) {
    let out = ''
    let n = number
    while (n > 0) {
      n -= 1
      out = String.fromCharCode(97 + (n % 26)) + out
      n = Math.floor(n / 26)
    }
    return `${out}.`
  }
  if (depth % 3 === 2) {
    let out = ''
    let n = number
    for (const [value, numeral] of ROMAN) {
      while (n >= value) {
        out += numeral
        n -= value
      }
    }
    return `${out}.`
  }
  return `${number}.`
}

function list(node: WriterNode, context: FlowContext, depth: number, rtl: boolean): FlowBlock[] {
  const ordered = node.type === 'orderedList'
  const start = numberAttr(node.attrs, 'start') ?? 1
  const listRTL = directionOf(node, rtl)
  const blocks: FlowBlock[] = []
  ;(node.content ?? []).forEach((item, index) => {
    ;(item.content ?? []).forEach((child, at) => {
      if (child.type === 'bulletList' || child.type === 'orderedList') {
        blocks.push(...list(child, context, depth + 1, listRTL))
      } else if (child.type === 'paragraph' || child.type === 'heading') {
        blocks.push(
          paragraph(child, context, {
            indent: LIST_INDENT * (depth + 1),
            marker: at === 0 ? listMarker(ordered, start + index, depth) : null,
            inList: true,
            rtl: listRTL
          })
        )
      } else blocks.push(...flowBlocks([child], context, listRTL))
    })
  })
  const last = blocks.at(-1)
  if (depth === 0 && last?.kind === 'paragraph') last.spaceAfter = PARAGRAPH_AFTER
  return blocks
}

function table(node: WriterNode, context: FlowContext, rtl: boolean): TableBlock {
  const tableRTL =
    stringAttr(node.attrs, 'dir') === 'rtl' || (stringAttr(node.attrs, 'dir') !== 'ltr' && rtl)
  const rows = (node.content ?? []).map((row) =>
    (row.content ?? []).map((cell) => ({
      blocks: flowBlocks(cell.content ?? [], context, tableRTL).map((block) =>
        block.kind === 'paragraph' ? { ...block, spaceAfter: 0 } : block
      ),
      colspan: Math.max(1, numberAttr(cell.attrs, 'colspan') ?? 1),
      header: cell.type === 'tableHeader',
      background: stringAttr(cell.attrs, 'background')
    }))
  )
  const count = Math.max(1, ...rows.map((row) => row.reduce((sum, cell) => sum + cell.colspan, 0)))
  const widths = Array.from({ length: count }, () => 0)
  const firstRow = node.content?.[0]?.content ?? []
  let column = 0
  for (const cell of firstRow) {
    const colwidth = cell.attrs?.colwidth
    const span = Math.max(1, numberAttr(cell.attrs, 'colspan') ?? 1)
    for (let i = 0; i < span; i += 1) {
      const width = Array.isArray(colwidth) ? colwidth[i] : null
      widths[column + i] = typeof width === 'number' && width > 0 ? width : 0
    }
    column += span
  }
  const known = widths.filter((width) => width > 0)
  const fallback = known.length ? known.reduce((a, b) => a + b, 0) / known.length : 1
  const filled = widths.map((width) => (width > 0 ? width : fallback))
  const total = filled.reduce((a, b) => a + b, 0)
  return { kind: 'table', rtl: tableRTL, rows, columns: filled.map((width) => width / total) }
}

function tableOfContents(body: WriterNode | null, context: FlowContext, rtl: boolean) {
  const entries: ParagraphBlock[] = []
  for (const node of body?.content ?? []) {
    const level = numberAttr(node.attrs, 'level') ?? 1
    if (node.type !== 'heading' || level > 3) continue
    const block = paragraph({ ...node, type: 'paragraph' }, context, {
      indent: 16 * (level - 1),
      marker: null,
      inList: true,
      rtl
    })
    block.toc = true
    entries.push(block)
  }
  return entries
}

/** The blocks of `nodes`, in reading order. `body` is the whole body, for a table of contents. */
export function flowBlocks(
  nodes: readonly WriterNode[],
  context: FlowContext,
  rtl = false,
  body: WriterNode | null = null
): FlowBlock[] {
  const blocks: FlowBlock[] = []
  for (const node of nodes) {
    switch (node.type) {
      case 'paragraph':
      case 'heading':
        blocks.push(paragraph(node, context, { indent: 0, marker: null, inList: false, rtl }))
        break
      case 'bulletList':
      case 'orderedList':
        blocks.push(...list(node, context, 0, rtl))
        break
      case 'table':
        blocks.push(table(node, context, rtl))
        break
      case 'pageBreak':
        blocks.push({ kind: 'pageBreak' })
        break
      case 'sectionBreak':
        blocks.push({ kind: 'sectionBreak', page: sectionPage(node) })
        break
      case 'tableOfContents':
        blocks.push(...tableOfContents(body, context, rtl))
        break
      default:
        if (node.content) blocks.push(...flowBlocks(node.content, context, rtl, body))
    }
  }
  return blocks
}
