import type { SceneNode } from '@lawha/scene-graph'

import { recordEdit } from '#core/editor/history/edit'
import { layerTheme, newLayerDefaults } from '#core/editor/shapes/defaults'
import type { EditorContext } from '#core/editor/types'
import {
  appliedMaster,
  applyMasterPage as applyMasterTo,
  createMasterPage as createMaster,
  isMasterPage,
  isPublicationLayer,
  linkTextFrames as linkFrames,
  makePageNumber,
  masterPages,
  publicationPages,
  reflowStories,
  reflowThread,
  refreshPageNumbers,
  removeMasterPage as removeMasterFrom,
  textFitsFrame,
  threadOf,
  unlinkTextFrame as unlinkFrame
} from '#core/publisher'

/** An A4 page at 96 pixels to the inch, for a master made with no page selected. */
const A4 = { width: 794, height: 1123 }
/** How far above the page's bottom edge a page number sits, as a share of the page's height. */
const PAGE_NUMBER_INSET = 0.04
const PAGE_NUMBER_FONT_SIZE = 12

/** Fields a write to which can move text between threaded frames. */
const REFLOW_FIELDS = new Set<string>([
  'text',
  'styleRuns',
  'width',
  'height',
  'fontSize',
  'fontFamily',
  'fontWeight',
  'lineHeight',
  'letterSpacing',
  'pluginData'
])

/**
 * Affinity Publisher's layout: master pages applied to page frames, text threaded through linked
 * frames, and page numbers. Page numbers and threaded text follow the document by themselves:
 * after edits that can change them they are worked out again, as derived values outside undo,
 * so undoing an edit brings them back in line too.
 */
export function createPublisherActions(ctx: EditorContext) {
  let scheduled = false
  let applying = false
  /** Whether the document holds anything to keep up to date; checked again as layers appear. */
  let active = false

  function selectedNodes(): SceneNode[] {
    return [...ctx.state.selectedIds].flatMap((id) => ctx.graph.getNode(id) ?? [])
  }

  function selectedPages(): SceneNode[] {
    const pages = new Set(publicationPages(ctx.graph, ctx.state.currentPageId).map((p) => p.id))
    return selectedNodes().filter((node) => pages.has(node.id))
  }

  /** Works out page numbers and threaded text again on the current page. */
  function refreshPublication(): string[] {
    scheduled = false
    if (applying) return []
    const editing = ctx.state.editingTextId
    const editingNode = editing ? ctx.graph.getNode(editing) : undefined
    const editingStory = editingNode ? threadOf(editingNode) : undefined
    applying = true
    try {
      const canvasId = ctx.state.currentPageId
      const written = [...refreshPageNumbers(ctx.graph, canvasId)]
      // The story being typed into flows once the edit ends, so the caret stays where it is.
      if (!editingStory) written.push(...reflowStories(ctx.graph, canvasId))
      if (written.length > 0) ctx.requestRender()
      return written
    } finally {
      applying = false
    }
  }

  function schedule() {
    if (applying || scheduled || !active) return
    scheduled = true
    queueMicrotask(refreshPublication)
  }

  function activate() {
    active = true
    schedule()
  }

  function nodeAffectsPublication(id: string, changes: Partial<SceneNode>): boolean {
    const node = ctx.graph.getNode(id)
    if (!node) return false
    if (isPublicationLayer(node)) return Object.keys(changes).some((key) => REFLOW_FIELDS.has(key))
    // A page moving can renumber the pages.
    const parent = node.parentId ? ctx.graph.getNode(node.parentId) : undefined
    return parent?.type === 'CANVAS' && ('x' in changes || 'y' in changes || 'visible' in changes)
  }

  ctx.onEditorEvent('node:updated', (id, changes) => {
    if (applying) return
    if (!active) {
      const node = ctx.graph.getNode(id)
      if (node && isPublicationLayer(node)) activate()
      return
    }
    if (nodeAffectsPublication(id, changes)) schedule()
  })
  ctx.onEditorEvent('node:created', (node) => {
    if (!active && isPublicationLayer(node)) activate()
    else if (node.type === 'FRAME') schedule()
  })
  for (const event of ['node:deleted', 'node:reparented', 'node:reordered'] as const) {
    ctx.onEditorEvent(event, () => schedule())
  }
  ctx.onEditorEvent('graph:replaced', (graph) => {
    active = [...graph.getAllNodes()].some(isPublicationLayer)
    schedule()
  })
  ctx.onEditorEvent('page:changed', () => schedule())
  ctx.onEditorEvent('selection:changed', () => {
    // A text edit ends with the selection; the story it was in flows then.
    if (!ctx.state.editingTextId) schedule()
  })

  function edit<T>(label: string, run: () => T): T {
    const result = recordEdit(ctx, { label }, () => {
      const value = run()
      refreshPublication()
      return value
    })
    active = true
    ctx.requestRender()
    return result
  }

  /**
   * Adds a master page the size of the selected page, or an A4 page without one. Returns it.
   */
  function createMasterPage(): string {
    const page = selectedPages().at(0)
    const size = page ? { width: page.width, height: page.height } : A4
    const master = edit('Create master page', () =>
      createMaster(ctx.graph, ctx.state.currentPageId, size)
    )
    ctx.setSelectedIds(new Set([master.id]))
    return master.id
  }

  /** The master pages on the current page, for menus that offer them. */
  function listMasterPages(): Array<{ id: string; name: string }> {
    return masterPages(ctx.graph, ctx.state.currentPageId).map(({ id, name }) => ({ id, name }))
  }

  /** Applies a master to the selected pages, or to `pageIds`. Returns how many it went on. */
  function applyMasterPage(masterId: string, pageIds?: string[]): number {
    const master = ctx.graph.getNode(masterId)
    if (!master || !isMasterPage(master)) return 0
    const pages = pageIds ? pageIds.flatMap((id) => ctx.graph.getNode(id) ?? []) : selectedPages()
    const targets = pages.filter((page) => page.type === 'FRAME')
    if (targets.length === 0) return 0
    edit('Apply master page', () => {
      for (const page of targets) applyMasterTo(ctx.graph, master, page)
    })
    return targets.length
  }

  /** Takes the master off the selected pages. */
  function removeMasterPage(): number {
    const pages = selectedPages()
    let removed = 0
    edit('Remove master page', () => {
      for (const page of pages) if (removeMasterFrom(ctx.graph, page)) removed++
    })
    return removed
  }

  /**
   * Adds a page number centred at the foot of the selected page or master page, which shows each
   * page its own number, `#` on the master. Returns the text, or null without a page selected.
   */
  function insertPageNumber(template = '{page}'): string | null {
    const target = selectedNodes().at(0)
    const pages = new Set(publicationPages(ctx.graph, ctx.state.currentPageId).map((p) => p.id))
    if (!target || (!pages.has(target.id) && !isMasterPage(target))) return null
    const width = Math.max(40, target.width * 0.2)
    const id = edit('Insert page number', () => {
      const text = ctx.graph.createNode('TEXT', target.id, {
        ...newLayerDefaults('TEXT', layerTheme(ctx.state)),
        name: 'Page number',
        text: '#',
        fontSize: PAGE_NUMBER_FONT_SIZE,
        textAlignHorizontal: 'CENTER',
        textAutoResize: 'HEIGHT',
        width,
        height: PAGE_NUMBER_FONT_SIZE * 1.4,
        x: (target.width - width) / 2,
        y: target.height * (1 - PAGE_NUMBER_INSET) - PAGE_NUMBER_FONT_SIZE * 1.4
      })
      makePageNumber(ctx.graph, text, template)
      return text.id
    })
    ctx.setSelectedIds(new Set([id]))
    return id
  }

  /**
   * Links the selected text frames in selection order, or `firstId` to `nextId`: text that
   * overflows a frame runs on into the next. Returns the story, or null when they cannot link.
   */
  function linkTextFrames(firstId?: string, nextId?: string): string | null {
    const ids = firstId && nextId ? [firstId, nextId] : [...ctx.state.selectedIds]
    const frames = ids.flatMap((id) => ctx.graph.getNode(id) ?? [])
    if (frames.length < 2 || frames.some((frame) => frame.type !== 'TEXT')) return null
    try {
      return edit('Link text frames', () => {
        let story = ''
        for (let i = 1; i < frames.length; i++) {
          story = linkFrames(
            ctx.graph,
            ctx.graph.getNode(frames[i - 1].id) ?? frames[i - 1],
            frames[i]
          )
        }
        reflowThread(ctx.graph, story, textFitsFrame)
        return story
      })
    } catch {
      return null
    }
  }

  /** Takes the selected text frames out of their stories; their text stays in the story. */
  function unlinkTextFrame(): number {
    const frames = selectedNodes().filter((node) => threadOf(node))
    if (frames.length === 0) return 0
    edit('Unlink text frame', () => {
      for (const frame of frames) unlinkFrame(ctx.graph, ctx.graph.getNode(frame.id) ?? frame)
    })
    return frames.length
  }

  /** What the selection offers for publishing, for menus to show the commands that apply. */
  function publicationSelection() {
    const nodes = selectedNodes()
    const pages = selectedPages()
    return {
      pages: pages.length,
      pagesWithMaster: pages.filter((page) => appliedMaster(ctx.graph, page)).length,
      master: nodes.length === 1 && isMasterPage(nodes[0]),
      texts: nodes.every((node) => node.type === 'TEXT') ? nodes.length : 0,
      threaded: nodes.filter((node) => threadOf(node)).length,
      masters: listMasterPages()
    }
  }

  return {
    publicationSelection,
    refreshPublication,
    createMasterPage,
    listMasterPages,
    applyMasterPage,
    removeMasterPage,
    insertPageNumber,
    linkTextFrames,
    unlinkTextFrame
  }
}
