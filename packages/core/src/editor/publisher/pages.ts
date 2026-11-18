import type { SceneNode } from '@lawha/scene-graph'
import { LAWHA_PLUGIN_DATA, withPluginData } from '@lawha/scene-graph/plugin-data'

import type { EditorContext } from '#core/editor/types'
import {
  appliedMaster,
  applyMasterPage,
  arrangePages,
  convertFrameToMaster,
  detachMasterPage,
  formatNumber,
  isMasterPage,
  pagesAnchor,
  publicationPages,
  publicationSettings,
  releaseDeletedFrames,
  removeMasterPage,
  spreadLayout,
  threadOf,
  type PublicationSettings,
  type SpreadSide
} from '#core/publisher'

/** One page as the Pages panel lists it. */
export interface PublicationPage {
  id: string
  name: string
  /** Its page number as page numbers on it show it. */
  number: string
  masterId: string | null
  masterName: string | null
  /** Which spread it is in and on which side, or `single` without spreads. */
  spread: number
  side: SpreadSide
}

/** An A4 page at 96 pixels to the inch, for a publication's first page. */
export const A4_PAGE = { width: 794, height: 1123 }

type Edit = <T>(label: string, run: () => T) => T

/**
 * Affinity Publisher's Pages panel: the publication's pages in reading order, which it adds,
 * duplicates, deletes, and reorders by laying the page frames out again in their new order;
 * the master each page shows; and how pages are numbered and face each other.
 */
export function createPublicationPageActions(ctx: EditorContext, edit: Edit) {
  const canvas = () => ctx.state.currentPageId
  const pages = () => publicationPages(ctx.graph, canvas())

  function getPublicationSettings(): PublicationSettings {
    return publicationSettings(ctx.graph, canvas())
  }

  function publicationPageList(): PublicationPage[] {
    const list = pages()
    const settings = getPublicationSettings()
    const layout = spreadLayout(list.length, settings)
    return list.map((page, index) => {
      const applied = appliedMaster(ctx.graph, page)
      const master = applied?.componentId ? ctx.graph.getNode(applied.componentId) : undefined
      return {
        id: page.id,
        name: page.name,
        number: formatNumber(index + settings.numberStart, settings.numberFormat),
        masterId: master?.id ?? null,
        masterName: master?.name ?? null,
        ...layout[index]
      }
    })
  }

  /** Lays the pages out in `order`, from where the publication starts now. */
  function arrange(
    order: readonly SceneNode[],
    anchor = pagesAnchor(pages(), direction()),
    follow: ReadonlySet<string> = new Set()
  ) {
    const settings = getPublicationSettings()
    arrangePages(
      ctx.graph,
      order.flatMap((page) => ctx.graph.getNode(page.id) ?? []),
      settings,
      anchor,
      follow
    )
  }

  function direction() {
    return getPublicationSettings().direction
  }

  /**
   * Changes how the publication is numbered and laid out. Changing the reading direction or
   * spreads lays the pages out again in the same reading order, apart from pages placed by
   * hand. One undo step.
   */
  function setPublicationSettings(changes: Partial<PublicationSettings>): void {
    const before = getPublicationSettings()
    const order = pages()
    const anchor = pagesAnchor(order, before.direction)
    edit('Publication settings', () => {
      const node = ctx.graph.getNode(canvas())
      if (!node) return
      const next = { ...before, ...changes }
      ctx.graph.updateNode(node.id, {
        pluginData: withPluginData(node.pluginData, LAWHA_PLUGIN_DATA.publication, next)
      })
      const relayout = next.direction !== before.direction || next.spreads !== before.spreads
      if (!relayout || !anchor) return
      // The first page keeps its place: its outer edge moves to the side it now starts from.
      const first = order[0]
      const start =
        next.direction === before.direction
          ? anchor
          : { x: next.direction === 'rtl' ? first.x + first.width : first.x, y: first.y }
      arrange(order, start)
    })
  }

  /**
   * Adds a page after `afterId` (the last page by default), the size of that page with its
   * master, and lays the pages out again. Returns the new page.
   */
  function addPublicationPage(afterId?: string, name = 'Page'): string {
    const order = pages()
    const index = afterId ? order.findIndex((page) => page.id === afterId) : order.length - 1
    const reference = order.at(index)
    const anchor = pagesAnchor(order, direction())
    return edit('Add page', () => {
      const page = ctx.graph.createNode('FRAME', canvas(), {
        name,
        x: reference ? reference.x : 0,
        y: reference ? reference.y : 0,
        width: reference?.width ?? A4_PAGE.width,
        height: reference?.height ?? A4_PAGE.height,
        fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1, visible: true }],
        clipsContent: true
      })
      const applied = reference && appliedMaster(ctx.graph, reference)
      const master = applied?.componentId ? ctx.graph.getNode(applied.componentId) : undefined
      if (master && isMasterPage(master)) applyMasterPage(ctx.graph, master, page)
      arrange(order.toSpliced(index + 1, 0, page), anchor)
      return page.id
    })
  }

  /** Copies a page with everything on it right after it. Returns the copy, or null. */
  function duplicatePublicationPage(pageId: string): string | null {
    const order = pages()
    const index = order.findIndex((page) => page.id === pageId)
    const source = order.at(index)
    if (index === -1 || !source) return null
    const anchor = pagesAnchor(order, direction())
    return edit('Duplicate page', () => {
      const copy = ctx.graph.cloneTree(source.id, canvas(), { name: source.name })
      if (!copy) return null
      // The copy's text frames start stories of their own rather than joining the original's.
      const stack = [...copy.childIds]
      while (stack.length > 0) {
        const id = stack.pop()
        const node = id === undefined ? undefined : ctx.graph.getNode(id)
        if (!node) continue
        stack.push(...node.childIds)
        if (threadOf(node)) {
          ctx.graph.updateNode(node.id, {
            pluginData: withPluginData(node.pluginData, LAWHA_PLUGIN_DATA.textThread, undefined)
          })
        }
      }
      arrange(order.toSpliced(index + 1, 0, copy), anchor)
      return copy.id
    })
  }

  /**
   * Deletes a page and closes the gap. Threaded text on it flows into the story's other frames.
   * The last page stays. False when nothing was deleted.
   */
  function deletePublicationPage(pageId: string): boolean {
    const order = pages()
    if (order.length <= 1 || !order.some((page) => page.id === pageId)) return false
    const anchor = pagesAnchor(order, direction())
    edit('Delete page', () => {
      releaseDeletedFrames(ctx.graph, [pageId])
      ctx.graph.deleteNode(pageId)
      arrange(
        order.filter((page) => page.id !== pageId),
        anchor
      )
    })
    if (ctx.state.selectedIds.has(pageId)) ctx.setSelectedIds(new Set())
    return true
  }

  /** Moves a page to `index` in reading order, laying the pages out again. */
  function movePublicationPage(pageId: string, index: number): boolean {
    const order = pages()
    const from = order.findIndex((page) => page.id === pageId)
    if (from === -1) return false
    const to = Math.max(0, Math.min(order.length - 1, index))
    if (from === to) return false
    const anchor = pagesAnchor(order, direction())
    const moved = order.toSpliced(from, 1).toSpliced(to, 0, order[from])
    // A page moved in the panel joins the layout, even one placed by hand before.
    edit('Move page', () => arrange(moved, anchor, new Set([pageId])))
    return true
  }

  /** Shows `masterId` behind a page, or takes its master off with null. */
  function setPublicationPageMaster(pageId: string, masterId: string | null): boolean {
    const page = ctx.graph.getNode(pageId)
    if (page?.type !== 'FRAME') return false
    const master = masterId ? ctx.graph.getNode(masterId) : undefined
    if (masterId && !isMasterPage(master)) return false
    return edit('Apply master page', () => {
      if (master) applyMasterPage(ctx.graph, master, page)
      else return removeMasterPage(ctx.graph, page)
      return true
    })
  }

  /**
   * Turns a page frame, the selected one by default, into a master page. Returns the master, or
   * null when it is not a frame.
   */
  function convertToMasterPage(frameId?: string): string | null {
    const id = frameId ?? [...ctx.state.selectedIds].at(0)
    const frame = id ? ctx.graph.getNode(id) : undefined
    if (frame?.type !== 'FRAME') return null
    const master = edit('Convert to master page', () => convertFrameToMaster(ctx.graph, frame))
    ctx.setSelectedIds(new Set([master.id]))
    return master.id
  }

  /**
   * Detaches pages from their master, the selected pages or `pageIds`: the master's layers become
   * each page's own. Returns how many were detached.
   */
  function detachFromMasterPage(pageIds?: string[]): number {
    const ids = pageIds ?? [...ctx.state.selectedIds]
    const targets = ids.flatMap((id) => ctx.graph.getNode(id) ?? [])
    const withMaster = targets.filter((page) => appliedMaster(ctx.graph, page))
    if (withMaster.length === 0) return 0
    edit('Detach from master', () => {
      for (const page of withMaster) detachMasterPage(ctx.graph, page)
    })
    return withMaster.length
  }

  return {
    getPublicationSettings,
    publicationPageList,
    setPublicationSettings,
    addPublicationPage,
    duplicatePublicationPage,
    deletePublicationPage,
    movePublicationPage,
    setPublicationPageMaster,
    convertToMasterPage,
    detachFromMasterPage
  }
}
