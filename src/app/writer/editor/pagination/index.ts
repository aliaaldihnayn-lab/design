import { Extension, type Editor } from '@tiptap/core'
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'

import { layoutPages, sameLayout, type BlockBox, type PageLayout } from './layout'

/**
 * Pages in the editor, as Google Docs and Word draw them: the body flows down one column, and
 * where a page ends a gap widget fills the rest of its text area, draws that page's footer, the
 * space between the sheets, and the next page's header, so text sits on separate pages with
 * their margins, headers, footers and page numbers. The body is measured as the browser lays it
 * out, so every font, table and image takes the room it really takes.
 */

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    writerPagination: { repaginate: () => ReturnType }
  }
}

/** The page geometry and the header and footer each gap draws, in CSS pixels. */
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

export interface PaginationOptions {
  page: () => PaginationPage | null
  /**
   * Fills a header or footer copy for `page` of `pages`, such as with the region's HTML and its
   * page fields' numbers; empty for no region.
   */
  region: (kind: 'header' | 'footer', element: HTMLElement, page: number, pages: number) => void
  /** Told each time the layout changes, such as to size the paper to its last page. */
  onLayout: (layout: PageLayout) => void
}

/** The layout the gaps draw, and a count bumped when their headers and footers must redraw. */
interface PaginationState {
  layout: PageLayout
  revision: number
}

type PaginationMeta = { layout: PageLayout } | { remeasure: true }

export const paginationKey = new PluginKey<PaginationState>('writerPagination')

const EMPTY: PaginationState = { layout: { breaks: [], pages: 1, lastFill: 0 }, revision: 0 }

function metaOf(value: unknown): PaginationMeta | null {
  if (!value || typeof value !== 'object') return null
  if ('layout' in value || 'remeasure' in value) return value as PaginationMeta
  return null
}
export const PAGE_GAP_CLASS = 'writer-page-gap'

/** The body's top-level blocks as the column lays them out, page gaps taken out. */
function measure(view: EditorView): BlockBox[] {
  const root = view.dom
  const boxes: BlockBox[] = []
  let removed = 0
  let index = 0
  const positions: number[] = []
  view.state.doc.forEach((_, offset) => positions.push(offset))
  for (const child of Array.from(root.children)) {
    if (!(child instanceof HTMLElement)) continue
    if (child.classList.contains(PAGE_GAP_CLASS)) {
      removed += child.offsetHeight
      continue
    }
    const position = positions.at(index)
    if (position === undefined) break
    if (view.nodeDOM(position) !== child) continue
    const node = view.state.doc.child(index)
    const style = getComputedStyle(child)
    const top = child.offsetTop - removed - Number.parseFloat(style.marginTop || '0')
    const bottom =
      child.offsetTop - removed + child.offsetHeight + Number.parseFloat(style.marginBottom || '0')
    boxes.push({
      top,
      bottom,
      breakAfter: node.type.name === 'pageBreak' || node.type.name === 'sectionBreak'
    })
    index += 1
  }
  return boxes
}

function gapWidget(
  options: PaginationOptions,
  page: PaginationPage,
  fill: number,
  number: number,
  pages: number
): HTMLElement {
  const gap = document.createElement('div')
  gap.className = PAGE_GAP_CLASS
  gap.contentEditable = 'false'
  gap.dataset.page = String(number)
  gap.setAttribute('aria-hidden', 'true')
  gap.style.height = `${fill + page.bottom + page.gap + page.top}px`
  gap.style.marginLeft = `${-page.left}px`
  gap.style.marginRight = `${-page.right}px`
  const footer = document.createElement('div')
  footer.className = 'writer-page-footer'
  footer.style.marginTop = `${fill}px`
  footer.style.height = `${page.bottom}px`
  footer.style.padding = `0 ${page.right}px ${page.footerDistance}px ${page.left}px`
  options.region('footer', footer, number, pages)
  const between = document.createElement('div')
  between.className = 'writer-page-between'
  between.style.height = `${page.gap}px`
  const header = document.createElement('div')
  header.className = 'writer-page-header'
  header.style.height = `${page.top}px`
  header.style.padding = `${page.headerDistance}px ${page.right}px 0 ${page.left}px`
  options.region('header', header, number + 1, pages)
  gap.append(footer, between, header)
  return gap
}

function decorations(state: EditorState, value: PaginationState, options: PaginationOptions) {
  const { layout } = value
  const page = options.page()
  if (!page || !layout.breaks.length) return DecorationSet.empty
  const positions: number[] = []
  state.doc.forEach((_, offset) => positions.push(offset))
  const widgets = layout.breaks.flatMap((entry, at) => {
    const position = positions.at(entry.index)
    if (position === undefined) return []
    const number = at + 1
    return [
      Decoration.widget(
        position,
        () => gapWidget(options, page, entry.fill, number, layout.pages),
        {
          side: -1,
          ignoreSelection: true,
          key: `page-${number}-${Math.round(entry.fill)}-${layout.pages}-${value.revision}`
        }
      )
    ]
  })
  return DecorationSet.create(state.doc, widgets)
}

export const Pagination = Extension.create<PaginationOptions>({
  name: 'writerPagination',

  addOptions: () => ({
    page: () => null,
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
        const page = options.page()
        if (!page || view.isDestroyed) return
        const layout = layoutPages(measure(view), page.contentHeight)
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
