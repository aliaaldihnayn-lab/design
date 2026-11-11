import type { PageSetup } from '#core/writer/model'

import type { FlowBlock, ParagraphBlock, RunStyle, TableBlock } from './flow'
import type { FontSet } from './fonts'
import { layoutLines, type FieldText, type GlyphPiece, type Line } from './lines'

/**
 * Pages: the body's blocks flowed into each page's text area, a paragraph split between pages
 * at a line, a table at a row, explicit page and section breaks honoured (each section on its
 * own page size), and every page given its header, footer and page number. Coordinates are
 * points from the page's top-left corner.
 */

export type DrawOp =
  | { kind: 'glyphs'; piece: GlyphPiece; x: number; baseline: number; spaceExtra: number }
  | { kind: 'image'; src: string; x: number; y: number; width: number; height: number }
  | { kind: 'rect'; x: number; y: number; width: number; height: number; color: string }
  | { kind: 'link'; x: number; y: number; width: number; height: number; href: string }
  | { kind: 'watermark'; piece: GlyphPiece; cx: number; cy: number }

export interface LaidOutPage {
  width: number
  height: number
  ops: DrawOp[]
}

const PT_PER_TWIP = 1 / 20
const CELL_PADDING = 5.4
const CELL_PADDING_Y = 2
const BORDER = 0.5
const MARKER_GAP = 6

interface Frame {
  left: number
  right: number
}

export interface PaginateInput {
  blocks: FlowBlock[]
  /** Each section's page setup, the last one the document's own. */
  pageFor: (section: number) => PageSetup
  header: FlowBlock[]
  footer: FlowBlock[]
  footnotes: Array<{ number: number; blocks: FlowBlock[] }>
  watermark: GlyphPiece | null
  fonts: FontSet
  /** Page numbers of the headings a table of contents lists, from a first pass. */
  headingPages?: readonly number[]
  pageCount?: number
}

export interface PaginateResult {
  pages: LaidOutPage[]
  headingPages: number[]
}

function lineX(line: Line, frame: Frame, block: ParagraphBlock, width: number) {
  const start = block.rtl ? 'right' : 'left'
  const end = block.rtl ? 'left' : 'right'
  const align = { start, justify: start, end }[block.align as string] ?? block.align
  const available = frame.right - frame.left
  const justify = block.align === 'justify' && !line.last && line.spaces > 0
  const spaceExtra = justify ? Math.max(0, (available - width) / line.spaces) : 0
  if (justify) return { x: frame.left, spaceExtra }
  if (align === 'right') return { x: frame.right - width, spaceExtra }
  if (align === 'center') return { x: frame.left + (available - width) / 2, spaceExtra }
  return { x: frame.left, spaceExtra }
}

/** The ops of one line, its top at `top`. */
function lineOps(
  line: Line,
  frame: Frame,
  block: ParagraphBlock,
  top: number,
  extraWidth = 0
): DrawOp[] {
  const ops: DrawOp[] = []
  const { x, spaceExtra } = lineX(line, frame, block, line.width + extraWidth)
  const baseline = top + (line.height - line.ascent - line.descent) / 2 + line.ascent
  let cx = x
  for (const piece of line.pieces) {
    if (piece.kind === 'image') {
      ops.push({
        kind: 'image',
        src: piece.src,
        x: cx,
        y: baseline - piece.height,
        width: piece.width,
        height: piece.height
      })
      cx += piece.width
      continue
    }
    const spaces = piece.text.split(' ').length - 1
    const width = piece.width + spaces * spaceExtra
    const style: RunStyle = piece.style
    const ascent = (piece.size * piece.face.ascender) / piece.face.upem
    const descent = (-piece.size * piece.face.descender) / piece.face.upem
    const glyphTop = baseline - piece.rise - ascent
    if (style.background) {
      ops.push({
        kind: 'rect',
        x: cx,
        y: glyphTop,
        width,
        height: ascent + descent,
        color: style.background
      })
    }
    ops.push({ kind: 'glyphs', piece, x: cx, baseline: baseline - piece.rise, spaceExtra })
    const thickness = Math.max(0.5, piece.size * 0.06)
    if (style.underline) {
      ops.push({
        kind: 'rect',
        x: cx,
        y: baseline - piece.rise + piece.size * 0.12,
        width,
        height: thickness,
        color: style.color
      })
    }
    if (style.strike) {
      ops.push({
        kind: 'rect',
        x: cx,
        y: baseline - piece.rise - piece.size * 0.28,
        width,
        height: thickness,
        color: style.color
      })
    }
    if (style.link) {
      ops.push({
        kind: 'link',
        x: cx,
        y: glyphTop,
        width,
        height: ascent + descent,
        href: style.link
      })
    }
    cx += width
  }
  return ops
}

/** A list marker beside the first line, in its first run's style, on the start side. */
function markerOps(
  block: ParagraphBlock,
  frame: Frame,
  top: number,
  line: Line,
  fonts: FontSet
): DrawOp[] {
  if (!block.marker) return []
  const style = block.runs.at(0)?.style
  if (!style) return []
  const marker: ParagraphBlock = {
    ...block,
    runs: [{ kind: 'text', text: block.marker, style: { ...style, link: null, underline: false } }],
    marker: null,
    align: 'start'
  }
  const markerLine = layoutLines(marker, 1000, fonts, () => '').at(0)
  if (!markerLine) return []
  const left = block.rtl ? frame.right + MARKER_GAP : frame.left - MARKER_GAP - markerLine.width
  const shifted = { ...markerLine, height: line.height, ascent: line.ascent, descent: line.descent }
  return lineOps(
    shifted,
    { left, right: left + markerLine.width },
    { ...marker, align: 'left' },
    top
  )
}

/** The frame a paragraph's lines fill, its indent taken from the start side. */
function paragraphFrame(block: ParagraphBlock, frame: Frame): Frame {
  return block.rtl
    ? { left: frame.left, right: frame.right - block.indent }
    : { left: frame.left + block.indent, right: frame.right }
}

/** A table of contents entry's page number, at the end of its last line. */
function tocNumberOps(
  block: ParagraphBlock,
  frame: Frame,
  top: number,
  line: Line,
  page: number | undefined,
  fonts: FontSet
): DrawOp[] {
  const style = block.runs.at(0)?.style
  if (page === undefined || !style) return []
  const entry: ParagraphBlock = {
    ...block,
    runs: [{ kind: 'text', text: String(page), style }],
    toc: false,
    align: block.rtl ? 'left' : 'right'
  }
  const numberLine = layoutLines(entry, 1000, fonts, () => '').at(0)
  if (!numberLine) return []
  const shifted = { ...numberLine, height: line.height, ascent: line.ascent, descent: line.descent }
  return lineOps(shifted, frame, entry, top)
}

const pageOf = (setup: PageSetup): LaidOutPage => ({
  width: setup.width * PT_PER_TWIP,
  height: setup.height * PT_PER_TWIP,
  ops: []
})

class Paginator {
  private setup: PageSetup
  private page: LaidOutPage
  readonly pages: LaidOutPage[]
  /** Each page's setup, by page. */
  private readonly setups: PageSetup[]
  private y: number
  private empty = true
  private section = 0
  readonly headingPages: number[] = []
  private tocIndex = 0

  constructor(private readonly input: PaginateInput) {
    this.setup = input.pageFor(0)
    this.page = pageOf(this.setup)
    this.pages = [this.page]
    this.setups = [this.setup]
    this.y = this.setup.margins.top * PT_PER_TWIP
  }

  private get frame(): Frame {
    return {
      left: this.setup.margins.left * PT_PER_TWIP,
      right: (this.setup.width - this.setup.margins.right) * PT_PER_TWIP
    }
  }

  private get bottom(): number {
    return (this.setup.height - this.setup.margins.bottom) * PT_PER_TWIP
  }

  private open(setup: PageSetup) {
    this.setup = setup
    this.page = pageOf(setup)
    this.pages.push(this.page)
    this.setups.push(setup)
    this.y = setup.margins.top * PT_PER_TWIP
    this.empty = true
  }

  private field: FieldText = (field) =>
    field === 'pageNumber' ? String(this.pages.length) : String(this.input.pageCount ?? '')

  flow(blocks: readonly FlowBlock[]) {
    for (const block of blocks) {
      if (block.kind === 'pageBreak') this.open(this.setup)
      else if (block.kind === 'sectionBreak') {
        this.section += 1
        this.open(this.input.pageFor(this.section))
      } else if (block.kind === 'paragraph') this.paragraph(block)
      else this.table(block)
    }
  }

  private paragraph(block: ParagraphBlock) {
    const frame = paragraphFrame(block, this.frame)
    const lines = layoutLines(block, frame.right - frame.left, this.input.fonts, this.field)
    if (!this.empty) this.y += block.spaceBefore
    if (block.heading !== null && block.heading <= 3 && !block.toc) {
      this.headingPages.push(this.pages.length)
    }
    const tocPage = block.toc ? this.input.headingPages?.[this.tocIndex++] : undefined
    lines.forEach((line, index) => {
      if (!this.empty && this.y + line.height > this.bottom) this.open(this.setup)
      if (index === 0)
        this.page.ops.push(...markerOps(block, frame, this.y, line, this.input.fonts))
      this.page.ops.push(...lineOps(line, frame, block, this.y))
      if (block.toc && index === lines.length - 1) {
        this.page.ops.push(...tocNumberOps(block, frame, this.y, line, tocPage, this.input.fonts))
      }
      this.y += line.height
      this.empty = false
    })
    this.y += block.spaceAfter
  }

  private table(block: TableBlock) {
    const frame = this.frame
    const tableWidth = frame.right - frame.left
    const widths = block.columns.map((fraction) => fraction * tableWidth)
    for (const row of block.rows) {
      const cells = cellRects(row, widths, frame, block.rtl)
      const laid = cells.map(({ cell, left, right }) => {
        const inner = { left: left + CELL_PADDING, right: right - CELL_PADDING }
        return {
          cell,
          left,
          right,
          ...blocksInFrame(cell.blocks, inner, this.input.fonts, this.field)
        }
      })
      const height = Math.max(0, ...laid.map((entry) => entry.height)) + 2 * CELL_PADDING_Y
      if (!this.empty && this.y + height > this.bottom) this.open(this.setup)
      const top = this.y
      for (const entry of laid) {
        const background = entry.cell.background ?? (entry.cell.header ? '#f2f2f2' : null)
        if (background) {
          this.page.ops.push({
            kind: 'rect',
            x: entry.left,
            y: top,
            width: entry.right - entry.left,
            height,
            color: background
          })
        }
        this.page.ops.push(...entry.ops.map((op) => offset(op, top + CELL_PADDING_Y)))
        this.page.ops.push(...borderOps(entry.left, top, entry.right - entry.left, height))
      }
      this.y += height
      this.empty = false
    }
    this.y += 6
  }

  /** Each page's header, footer and watermark, once the body is laid out. */
  decorate() {
    const { fonts } = this.input
    this.pages.forEach((page, index) => {
      const setup = this.setups[index] ?? this.setup
      const frame = {
        left: setup.margins.left * PT_PER_TWIP,
        right: (setup.width - setup.margins.right) * PT_PER_TWIP
      }
      const field: FieldText = (kind) =>
        kind === 'pageNumber' ? String(index + 1) : String(this.pages.length)
      if (this.input.watermark) {
        page.ops.unshift({
          kind: 'watermark',
          piece: this.input.watermark,
          cx: page.width / 2,
          cy: page.height / 2
        })
      }
      if (this.input.header.length) {
        const header = blocksInFrame(this.input.header, frame, fonts, field)
        page.ops.push(...header.ops.map((op) => offset(op, setup.margins.header * PT_PER_TWIP)))
      }
      if (this.input.footer.length) {
        const footer = blocksInFrame(this.input.footer, frame, fonts, field)
        const top = page.height - setup.margins.footer * PT_PER_TWIP - footer.height
        page.ops.push(...footer.ops.map((op) => offset(op, top)))
      }
    })
  }

  footnotes() {
    const notes = this.input.footnotes
    if (!notes.length) return
    const frame = this.frame
    this.y += 12
    if (this.y + 20 > this.bottom) this.open(this.setup)
    this.page.ops.push({
      kind: 'rect',
      x: frame.left,
      y: this.y,
      width: (frame.right - frame.left) / 3,
      height: 0.5,
      color: '#000000'
    })
    this.y += 6
    for (const note of notes) {
      const blocks = note.blocks.map((block, index) =>
        block.kind === 'paragraph'
          ? {
              ...block,
              indent: 14,
              spaceAfter: 2,
              marker: index === 0 ? String(note.number) : null,
              runs: block.runs.map((run) => ({ ...run, style: { ...run.style, size: 9 } }))
            }
          : block
      )
      this.flow(blocks)
    }
  }
}

function offset(op: DrawOp, dy: number): DrawOp {
  switch (op.kind) {
    case 'glyphs':
      return { ...op, baseline: op.baseline + dy }
    case 'watermark':
      return { ...op, cy: op.cy + dy }
    default:
      return { ...op, y: op.y + dy }
  }
}

function borderOps(x: number, y: number, width: number, height: number): DrawOp[] {
  const color = '#000000'
  return [
    { kind: 'rect', x, y, width, height: BORDER, color },
    { kind: 'rect', x, y: y + height - BORDER, width, height: BORDER, color },
    { kind: 'rect', x, y, width: BORDER, height, color },
    { kind: 'rect', x: x + width - BORDER, y, width: BORDER, height, color }
  ]
}

/** Cells' left and right edges; a right-to-left table puts its first column on the right. */
function cellRects(
  row: TableBlock['rows'][number],
  widths: readonly number[],
  frame: Frame,
  rtl: boolean
) {
  let column = 0
  return row.map((cell) => {
    const width = widths.slice(column, column + cell.colspan).reduce((a, b) => a + b, 0)
    const before = widths.slice(0, column).reduce((a, b) => a + b, 0)
    column += cell.colspan
    const left = rtl ? frame.right - before - width : frame.left + before
    return { cell, left, right: left + width }
  })
}

/** Blocks laid out in a frame that does not break across pages, as in a cell or a header. */
export function blocksInFrame(
  blocks: readonly FlowBlock[],
  frame: Frame,
  fonts: FontSet,
  field: FieldText
): { ops: DrawOp[]; height: number } {
  const ops: DrawOp[] = []
  let y = 0
  let first = true
  for (const block of blocks) {
    if (block.kind !== 'paragraph') continue
    const inner = paragraphFrame(block, frame)
    if (!first) y += block.spaceBefore
    const lines = layoutLines(block, inner.right - inner.left, fonts, field)
    for (const [index, line] of lines.entries()) {
      if (index === 0) ops.push(...markerOps(block, inner, y, line, fonts))
      ops.push(...lineOps(line, inner, block, y))
      y += line.height
    }
    y += block.spaceAfter
    first = false
  }
  return { ops, height: y }
}

/** Lays the body out on pages, with headers, footers and page numbers on each. */
export function paginate(input: PaginateInput): PaginateResult {
  const paginator = new Paginator(input)
  paginator.flow(input.blocks)
  paginator.footnotes()
  paginator.decorate()
  return { pages: paginator.pages, headingPages: paginator.headingPages }
}
