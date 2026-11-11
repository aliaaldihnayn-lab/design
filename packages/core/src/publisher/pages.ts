import type { SceneGraph, SceneNode } from '@lawha/scene-graph'
import { LAWHA_PLUGIN_DATA, readPluginData, withPluginData } from '@lawha/scene-graph/plugin-data'
import type { Vector } from '@lawha/scene-graph/primitives'

/** How a canvas page is laid out as a publication. */
export interface PublicationSettings {
  numberStart: number
  numberFormat: PageNumberFormat
  direction: 'ltr' | 'rtl'
  spreads: boolean
}

/** The digits a page number is written in: 1 2 3, ١ ٢ ٣, i ii iii, or I II III. */
export type PageNumberFormat = 'western' | 'arabic-indic' | 'roman' | 'roman-upper'

export const DEFAULT_PUBLICATION_SETTINGS: PublicationSettings = {
  numberStart: 1,
  numberFormat: 'western',
  direction: 'ltr',
  spreads: false
}

/** A canvas page's publication settings, with defaults for what it does not set. */
export function publicationSettings(graph: SceneGraph, canvasId: string): PublicationSettings {
  const stored = readPluginData(graph.getNode(canvasId)?.pluginData, LAWHA_PLUGIN_DATA.publication)
  return { ...DEFAULT_PUBLICATION_SETTINGS, ...stored }
}

/**
 * A publication's pages are the frames placed directly on a canvas page, in reading order: rows
 * from the top, each row from the left, or from the right in a right-to-left publication. Master
 * pages, being components, are not pages.
 */
export function publicationPages(graph: SceneGraph, canvasId: string): SceneNode[] {
  const rtl = publicationSettings(graph, canvasId).direction === 'rtl'
  const canvas = graph.getNode(canvasId)
  if (!canvas) return []
  const frames = canvas.childIds.flatMap((id) => {
    const node = graph.getNode(id)
    return node?.type === 'FRAME' && node.visible ? [node] : []
  })
  // A frame starts a new row once it sits below half the height of the row's first frame.
  const sorted = frames.toSorted((a, b) => a.y - b.y || a.x - b.x)
  const rows: SceneNode[][] = []
  for (const frame of sorted) {
    const row = rows.at(-1)
    const first = row?.[0]
    if (row && first && frame.y < first.y + first.height / 2) row.push(frame)
    else rows.push([frame])
  }
  return rows.flatMap((row) => row.toSorted((a, b) => (rtl ? b.x - a.x : a.x - b.x)))
}

export function isMasterPage(node: SceneNode | undefined): boolean {
  return (
    node?.type === 'COMPONENT' &&
    readPluginData(node.pluginData, LAWHA_PLUGIN_DATA.masterPage)?.role === 'master'
  )
}

/** The master pages of a canvas page, in layer order. */
export function masterPages(graph: SceneGraph, canvasId: string): SceneNode[] {
  return (graph.getNode(canvasId)?.childIds ?? []).flatMap((id) => {
    const node = graph.getNode(id)
    return node && isMasterPage(node) ? [node] : []
  })
}

/** The instance a page shows its master through, if one is applied. */
export function appliedMaster(graph: SceneGraph, page: SceneNode): SceneNode | undefined {
  return page.childIds
    .map((id) => graph.getNode(id))
    .find(
      (child) =>
        child?.type === 'INSTANCE' &&
        readPluginData(child.pluginData, LAWHA_PLUGIN_DATA.masterPage)?.role === 'applied'
    )
}

/** The frame on the canvas a layer is in: the layer itself or its outermost container. */
export function topLevelAncestor(graph: SceneGraph, node: SceneNode): SceneNode | undefined {
  let current: SceneNode = node
  while (current.parentId) {
    const parent = graph.getNode(current.parentId)
    if (!parent || parent.type === 'CANVAS') return current
    current = parent
  }
  return undefined
}

/** The canvas page a layer is on. */
export function canvasOf(graph: SceneGraph, node: SceneNode): SceneNode | undefined {
  const top = topLevelAncestor(graph, node)
  return top?.parentId ? graph.getNode(top.parentId) : undefined
}

const ARABIC_INDIC_DIGITS = '٠١٢٣٤٥٦٧٨٩'
const ROMAN: ReadonlyArray<readonly [number, string]> = [
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

/** `value` written in `format`; Roman numerals fall back to digits outside 1–3999. */
export function formatNumber(value: number, format: PageNumberFormat = 'western'): string {
  if (format === 'arabic-indic') {
    return String(value).replaceAll(/\d/g, (digit) => ARABIC_INDIC_DIGITS[Number(digit)])
  }
  if ((format === 'roman' || format === 'roman-upper') && value >= 1 && value < 4000) {
    let rest = value
    let out = ''
    for (const [amount, numeral] of ROMAN) {
      while (rest >= amount) {
        out += numeral
        rest -= amount
      }
    }
    return format === 'roman-upper' ? out.toUpperCase() : out
  }
  return String(value)
}

/**
 * A page number template filled in: `{page}` is the number, `{pages}` the page count, both in
 * `format`; a master page shows `#` for its number.
 */
export function formatPageNumber(
  template: string,
  page: number | null,
  pages: number,
  format: PageNumberFormat = 'western'
): string {
  return template
    .replaceAll('{page}', page === null ? '#' : formatNumber(page, format))
    .replaceAll('{pages}', formatNumber(pages, format))
}

/** Where a page sits in its spread: alone, or on the left or right of two facing pages. */
export type SpreadSide = 'single' | 'left' | 'right'

/**
 * How pages in reading order pair into spreads: the first page alone, then two at a time, as a
 * bound book opens. In a left-to-right book the first page is a right-hand page and each spread
 * reads left then right; right to left, the other way round.
 */
export function spreadLayout(
  count: number,
  settings: Pick<PublicationSettings, 'spreads' | 'direction'>
): Array<{ spread: number; side: SpreadSide }> {
  const rtl = settings.direction === 'rtl'
  return Array.from({ length: count }, (_, index) => {
    if (!settings.spreads) return { spread: index, side: 'single' }
    if (index === 0) return { spread: 0, side: rtl ? 'left' : 'right' }
    const first = index % 2 === 1
    return { spread: Math.ceil(index / 2), side: first === rtl ? 'right' : 'left' }
  })
}

/** Space between spreads, or between pages that do not face each other. */
export const PAGE_GAP = 100

/**
 * Where a publication's pages start: the first laid-out page's outer edge in reading order, its left in a
 * left-to-right publication and its right in a right-to-left one, and its top.
 */
export function pagesAnchor(
  pages: readonly SceneNode[],
  direction: PublicationSettings['direction']
): Vector | null {
  if (pages.length === 0) return null
  // Pages placed by hand stand apart; the layout starts at the first page it placed.
  const first = pages.find((page) => !isManuallyPlaced(page)) ?? pages[0]
  return { x: direction === 'rtl' ? first.x + first.width : first.x, y: first.y }
}

/**
 * Whether a page was placed by hand: moved away from where the Pages panel last laid it out. A
 * page the panel never placed joins the layout.
 */
export function isManuallyPlaced(page: SceneNode): boolean {
  const placed = readPluginData(page.pluginData, LAWHA_PLUGIN_DATA.pagePlacement)
  return !!placed && (Math.abs(placed.x - page.x) > 0.5 || Math.abs(placed.y - page.y) > 0.5)
}

/**
 * Lays `pages` out on the canvas in that reading order from `anchor` (where the first page
 * starts, by default where it is now): side by side in one row, or with spreads, each spread on
 * a row of its own with its two pages meeting at the spine, the first page on the side a book
 * opens to. Right to left, pages run leftwards from the anchor. Pages placed by hand keep their
 * place and take no slot; `ids` given in `follow` join the layout whatever their place.
 */
export function arrangePages(
  graph: SceneGraph,
  pages: readonly SceneNode[],
  settings: Pick<PublicationSettings, 'spreads' | 'direction'>,
  anchor = pagesAnchor(pages, settings.direction),
  follow: ReadonlySet<string> = new Set()
): void {
  const placed = pages.filter((page) => follow.has(page.id) || !isManuallyPlaced(page))
  if (!anchor || placed.length === 0) return
  const place = (page: SceneNode, x: number, y: number) => {
    graph.updateNode(page.id, {
      x,
      y,
      pluginData: withPluginData(page.pluginData, LAWHA_PLUGIN_DATA.pagePlacement, { x, y })
    })
  }
  const rtl = settings.direction === 'rtl'
  if (!settings.spreads) {
    let edge = anchor.x
    for (const page of placed) {
      place(page, rtl ? edge - page.width : edge, anchor.y)
      edge = rtl ? edge - page.width - PAGE_GAP : edge + page.width + PAGE_GAP
    }
    return
  }
  const layout = spreadLayout(placed.length, settings)
  // A book opens to its first page: the spine is that page's inner edge.
  const spine = anchor.x
  let y = anchor.y
  let row = 0
  let rowHeight = 0
  placed.forEach((page, index) => {
    const { spread, side } = layout[index]
    if (spread !== row) {
      y += rowHeight + PAGE_GAP
      row = spread
      rowHeight = 0
    }
    rowHeight = Math.max(rowHeight, page.height)
    place(page, side === 'right' ? spine : spine - page.width, y)
  })
}
