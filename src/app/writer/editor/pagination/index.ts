import { Extension, type Editor } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'

import {
  EMPTY_LAYOUT,
  layoutPages,
  sameLayout,
  type BlockBox,
  type BlockPiece,
  type PageLayout
} from './layout'

/**
 * Pages in the editor, as Google Docs and Word draw them: the body flows down one column, and
 * where a page ends a gap widget fills the rest of its text area, draws that page's footer, the
 * space between the sheets, and the next page's header, so text sits on separate pages with
 * their margins, headers, footers and page numbers. The body is measured as the browser lays it
 * out, so every font, table and image takes the room it really takes. Each section keeps its
 * own sheet: the paper is as wide as the widest, sheets are centred on it, and a section whose
 * text column differs from the document's has its blocks moved and sized to it.
 */

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    writerPagination: { repaginate: () => ReturnType }
  }
}

/** A page's margins and the space between sheets, in CSS pixels. */
export interface PaginationPage {
  /** The page's text height: its height less the top and bottom margins. */
  contentHeight: number
  top: number
  bottom: number
  left: number
  right: number
  /** Space between two sheets. */
  gap: number
  /** Where the header and footer start in the margin, from the page edge. */
  headerDistance: number
  footerDistance: number
}

/** A section's sheet: its size and margins, in CSS pixels. */
export interface PaginationSection extends PaginationPage {
  width: number
  height: number
}

export interface PaginationOptions {
  /** Each section's sheet in order, the document's own last; null before the page is known. */
  sections: () => PaginationSection[] | null
  /**
   * Fills a header or footer copy for `page` of `pages` in `section`, such as with the region's
   * HTML and its page fields' numbers; empty for no region.
   */
  region: (
    kind: 'header' | 'footer',
    element: HTMLElement,
    page: number,
    pages: number,
    section: number
  ) => void
  /** Told each time the layout changes, such as to size the paper to its pages. */
  onLayout: (layout: PageLayout) => void
}

/** The layout the gaps draw, and a count bumped when their headers and footers must redraw. */
interface PaginationState {
  layout: PageLayout
  revision: number
}

type PaginationMeta = { layout: PageLayout } | { remeasure: true }

export const paginationKey = new PluginKey<PaginationState>('writerPagination')

const EMPTY: PaginationState = { layout: EMPTY_LAYOUT, revision: 0 }

function metaOf(value: unknown): PaginationMeta | null {
  if (!value || typeof value !== 'object') return null
  if ('layout' in value || 'remeasure' in value) return value as PaginationMeta
  return null
}
export const PAGE_GAP_CLASS = 'writer-page-gap'
const ROW_GAP_CLASS = 'writer-page-gap-row'

/** The widest sheet, which the paper is as wide as. */
export function paperWidth(sections: readonly PaginationSection[]): number {
  return Math.max(0, ...sections.map((section) => section.width))
}

/** Where a section's text starts from the paper's left edge; sheets are centred on the paper. */
function textLeft(section: PaginationSection, width: number): number {
  return (width - section.width) / 2 + section.left
}

/** The section of each top-level block: a section break is the last block of its own. */
function blockSections(doc: ProseMirrorNode): number[] {
  const sections: number[] = []
  let section = 0
  doc.forEach((node) => {
    sections.push(section)
    if (node.type.name === 'sectionBreak') section += 1
  })
  return sections
}

/** Heights of the page gaps above a point, to take out of the laid-out column. */
function unbroken(root: HTMLElement) {
  const origin = root.getBoundingClientRect().top
  const gaps = Array.from(
    root.querySelectorAll<HTMLElement>(`.${PAGE_GAP_CLASS}, .${ROW_GAP_CLASS}`)
  )
    .filter((gap) => !gap.parentElement?.closest(`.${PAGE_GAP_CLASS}, .${ROW_GAP_CLASS}`))
    .map((gap) => {
      const rect = gap.getBoundingClientRect()
      return { top: rect.top - origin, bottom: rect.bottom - origin }
    })
  const at = (clientY: number) => {
    const y = clientY - origin
    let removed = 0
    for (const gap of gaps) if (gap.top < y - 0.5) removed += Math.min(y, gap.bottom) - gap.top
    return y - removed
  }
  const inGap = (clientY: number) =>
    gaps.some((gap) => clientY - origin >= gap.top && clientY - origin < gap.bottom)
  return { at, inGap }
}

/** A paragraph's lines in the unbroken column, each with the position it starts at. */
function linePieces(
  view: EditorView,
  element: HTMLElement,
  from: number,
  to: number,
  column: ReturnType<typeof unbroken>
): BlockPiece[] {
  const range = document.createRange()
  range.selectNodeContents(element)
  const rtl = getComputedStyle(element).direction === 'rtl'
  const lines = new Map<number, DOMRect[]>()
  for (const rect of Array.from(range.getClientRects())) {
    if (!rect.height || column.inGap(rect.top + rect.height / 2)) continue
    const key = Math.round(column.at(rect.top))
    lines.set(key, [...(lines.get(key) ?? []), rect])
  }
  return [...lines.entries()]
    .sort(([a], [b]) => a - b)
    .flatMap(([top, rects]) => {
      const bottom = Math.max(...rects.map((rect) => column.at(rect.bottom)))
      const edge = rtl
        ? Math.max(...rects.map((rect) => rect.right)) - 2
        : Math.min(...rects.map((rect) => rect.left)) + 2
      const middle = (rects[0]?.top ?? 0) + (rects[0]?.height ?? 0) / 2
      const found = view.posAtCoords({ left: edge, top: middle })
      if (!found) return []
      return [{ top, bottom, pos: Math.min(Math.max(found.pos, from + 1), to - 1) }]
    })
}

/** A table's rows in the unbroken column, each with the position before it. */
function rowPieces(
  view: EditorView,
  element: HTMLElement,
  column: ReturnType<typeof unbroken>
): BlockPiece[] {
  return Array.from(element.querySelectorAll('tr'))
    .filter((row) => !row.classList.contains(ROW_GAP_CLASS))
    .map((row) => {
      const rect = row.getBoundingClientRect()
      return {
        top: column.at(rect.top),
        bottom: column.at(rect.bottom),
        pos: view.posAtDOM(row, 0) - 1
      }
    })
}

/** The body's top-level blocks as the column lays them out, page gaps taken out. */
function measure(view: EditorView, heights: (section: number) => number): BlockBox[] {
  const column = unbroken(view.dom)
  const sections = blockSections(view.state.doc)
  const boxes: BlockBox[] = []
  view.state.doc.forEach((node, offset, index) => {
    const element = view.nodeDOM(offset)
    if (!(element instanceof HTMLElement)) return
    const style = getComputedStyle(element)
    const rect = element.getBoundingClientRect()
    const top = column.at(rect.top) - Number.parseFloat(style.marginTop || '0')
    const bottom = column.at(rect.bottom) + Number.parseFloat(style.marginBottom || '0')
    const section = sections[index] ?? 0
    const box: BlockBox = {
      top,
      bottom,
      breakAfter: node.type.name === 'pageBreak' || node.type.name === 'sectionBreak',
      endsSection: node.type.name === 'sectionBreak',
      section
    }
    if (bottom - top > heights(section)) {
      if (node.isTextblock) {
        box.pieces = linePieces(view, element, offset, offset + node.nodeSize, column)
        box.split = 'line'
      } else if (node.type.name === 'table') {
        box.pieces = rowPieces(view, element, column)
        box.split = 'row'
      }
    }
    boxes.push(box)
  })
  return boxes
}

/** Pixel offsets of a page gap: its paper edges, from the element it is drawn in. */
interface GapFrame {
  /** The paper's left edge from the left of what the gap sits in. */
  left: number
  width: number
}

function regionBox(
  element: HTMLElement,
  section: PaginationSection,
  width: number,
  vertical: string
) {
  const left = textLeft(section, width)
  element.style.padding = `${vertical} ${width - left - (section.width - section.left - section.right)}px 0 ${left}px`
}

function gapWidget(
  options: PaginationOptions,
  sections: readonly PaginationSection[],
  before: number,
  after: number,
  frame: GapFrame,
  fill: number,
  number: number,
  pages: number
): HTMLElement {
  const width = paperWidth(sections)
  const above = sections[before] ?? sections.at(-1)
  const below = sections[after] ?? sections.at(-1)
  const gap = document.createElement('div')
  gap.className = PAGE_GAP_CLASS
  gap.contentEditable = 'false'
  gap.dataset.page = String(number)
  gap.setAttribute('aria-hidden', 'true')
  if (!above || !below) return gap
  gap.style.height = `${fill + above.bottom + above.gap + below.top}px`
  gap.style.marginLeft = `${-frame.left}px`
  gap.style.width = `${width}px`
  const footer = document.createElement('div')
  footer.className = 'writer-page-footer'
  footer.style.marginTop = `${fill}px`
  footer.style.height = `${above.bottom}px`
  regionBox(footer, above, width, '0')
  footer.style.paddingBottom = `${above.footerDistance}px`
  options.region('footer', footer, number, pages, before)
  const between = document.createElement('div')
  between.className = 'writer-page-between'
  between.style.height = `${above.gap}px`
  const header = document.createElement('div')
  header.className = 'writer-page-header'
  header.style.height = `${below.top}px`
  regionBox(header, below, width, `${below.headerDistance}px`)
  options.region('header', header, number + 1, pages, after)
  gap.append(footer, between, header)
  return gap
}

/** A page gap between two rows of a table: a row of its own across the table. */
function rowGapWidget(gap: HTMLElement): HTMLElement {
  const row = document.createElement('tr')
  row.className = ROW_GAP_CLASS
  row.contentEditable = 'false'
  const cell = document.createElement('td')
  cell.colSpan = 1000
  cell.append(gap)
  row.append(cell)
  return row
}

/** How a section's text column sits on the paper, against the paper's own column. */
function columnStyle(
  section: PaginationSection,
  base: PaginationSection,
  width: number
): string | null {
  const shift = textLeft(section, width) - textLeft(base, width)
  const text = section.width - section.left - section.right
  const baseText = base.width - base.left - base.right
  if (Math.abs(shift) < 0.5 && Math.abs(text - baseText) < 0.5) return null
  return `box-sizing: border-box; width: ${text}px; translate: ${shift}px 0`
}

function decorations(state: EditorState, value: PaginationState, options: PaginationOptions) {
  const { layout } = value
  const sections = options.sections()
  const base = sections?.at(-1)
  if (!sections || !base) return DecorationSet.empty
  const width = paperWidth(sections)
  const blockSection = blockSections(state.doc)
  const positions: number[] = []
  const shifts: number[] = []
  const nodes: Decoration[] = []
  state.doc.forEach((node, offset, index) => {
    positions.push(offset)
    const section = sections[blockSection[index] ?? 0] ?? base
    shifts.push(textLeft(section, width) - textLeft(base, width))
    const style = columnStyle(section, base, width)
    if (style) nodes.push(Decoration.node(offset, offset + node.nodeSize, { style }))
  })
  const baseLeft = textLeft(base, width)
  const widgets = layout.breaks.flatMap((entry, at) => {
    const position = entry.pos ?? positions.at(entry.index)
    if (position === undefined) return []
    const number = at + 1
    const before = layout.sections[at] ?? 0
    const after = layout.sections[at + 1] ?? before
    // A gap inside a block sits in its column, which a section may have moved.
    const inside = entry.pos === undefined ? 0 : (shifts[entry.index] ?? 0)
    const frame = { left: baseLeft + inside, width }
    const draw = () => {
      const gap = gapWidget(
        options,
        sections,
        before,
        after,
        frame,
        entry.fill,
        number,
        layout.pages
      )
      return entry.split === 'row' ? rowGapWidget(gap) : gap
    }
    return [
      Decoration.widget(position, draw, {
        side: -1,
        ignoreSelection: true,
        key: `page-${number}-${position}-${Math.round(entry.fill)}-${layout.pages}-${before}-${after}-${value.revision}`
      })
    ]
  })
  return DecorationSet.create(state.doc, [...nodes, ...widgets])
}

export const Pagination = Extension.create<PaginationOptions>({
  name: 'writerPagination',

  addOptions: () => ({
    sections: () => null,
    region: () => undefined,
    onLayout: () => undefined
  }),

  addCommands() {
    return {
      repaginate:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) tr.setMeta(paginationKey, { remeasure: true } satisfies PaginationMeta)
          return true
        }
    }
  },

  addProseMirrorPlugins() {
    const options = this.options
    const editor: Editor = this.editor
    let frame = 0
    let forced = false
    const schedule = (view: EditorView) => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const sections = options.sections()
        if (!sections?.length || view.isDestroyed) return
        const height = (section: number) =>
          (sections[section] ?? sections.at(-1))?.contentHeight ?? 0
        const layout = layoutPages(measure(view, height), height)
        const current = paginationKey.getState(view.state) ?? EMPTY
        if (!forced && sameLayout(layout, current.layout)) return
        forced = false
        view.dispatch(view.state.tr.setMeta(paginationKey, { layout } satisfies PaginationMeta))
        options.onLayout(layout)
      })
    }
    return [
      new Plugin<PaginationState>({
        key: paginationKey,
        state: {
          init: () => EMPTY,
          apply: (tr, value) => {
            const meta = metaOf(tr.getMeta(paginationKey))
            if (!meta) return value
            if ('layout' in meta) return { layout: meta.layout, revision: value.revision }
            return { ...value, revision: value.revision + 1 }
          }
        },
        props: {
          decorations: (state) =>
            decorations(state, paginationKey.getState(state) ?? EMPTY, options)
        },
        view: (view) => {
          schedule(view)
          const resize = new ResizeObserver(() => schedule(view))
          resize.observe(view.dom)
          void document.fonts.ready.then(() => schedule(view))
          return {
            update: (updated, previous) => {
              if (updated.state.doc !== previous.doc) schedule(updated)
            },
            destroy: () => {
              cancelAnimationFrame(frame)
              resize.disconnect()
            }
          }
        },
        appendTransaction: (transactions) => {
          for (const tr of transactions) {
            const meta = metaOf(tr.getMeta(paginationKey))
            if (meta && 'remeasure' in meta) {
              forced = true
              schedule(editor.view)
            }
          }
          return null
        }
      })
    ]
  }
})
