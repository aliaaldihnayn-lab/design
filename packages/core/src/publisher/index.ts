import type { SceneGraph, SceneNode, StyleRun } from '@lawha/scene-graph'
import {
  cloneInstanceOverrideState,
  setInstanceOverride
} from '@lawha/scene-graph/instances/overrides'
import { LAWHA_PLUGIN_DATA, readPluginData, withPluginData } from '@lawha/scene-graph/plugin-data'

import { measureTextForLayout } from '#core/layout/text-measurement'

import {
  appliedMaster,
  canvasOf,
  formatPageNumber,
  isMasterPage,
  masterPages,
  publicationPages,
  publicationSettings,
  topLevelAncestor
} from './pages'
import { reflowThread, threadOf } from './threads'

export {
  appliedMaster,
  arrangePages,
  canvasOf,
  DEFAULT_PUBLICATION_SETTINGS,
  formatNumber,
  formatPageNumber,
  isMasterPage,
  masterPages,
  PAGE_GAP,
  pagesAnchor,
  publicationPages,
  publicationSettings,
  spreadLayout,
  type PageNumberFormat,
  type PublicationSettings,
  type SpreadSide
} from './pages'
export {
  composeStory,
  flowText,
  linkTextFrames,
  reflowThread,
  releaseDeletedFrames,
  sliceRuns,
  threadFrames,
  threadOf,
  unlinkTextFrame,
  type FlowedFrame,
  type FrameFits,
  type Story
} from './threads'

/** Where a new master page goes: above the pages, clear of everything on the canvas. */
const MASTER_GAP = 200

/** The next free master name: Master A, Master B, … as in Affinity Publisher. */
function nextMasterName(graph: SceneGraph, canvasId: string): string {
  const taken = new Set(masterPages(graph, canvasId).map((master) => master.name))
  for (let code = 65; code <= 90; code++) {
    const name = `Master ${String.fromCodePoint(code)}`
    if (!taken.has(name)) return name
  }
  return `Master ${taken.size + 1}`
}

/** Where the next master page goes: in the row of masters above the pages. */
function nextMasterPlace(graph: SceneGraph, canvasId: string, size: { height: number }) {
  const pages = publicationPages(graph, canvasId)
  const top = Math.min(0, ...pages.map((page) => page.y))
  const left = Math.min(0, ...pages.map((page) => page.x))
  const existing = masterPages(graph, canvasId)
  const x = left + existing.reduce((sum, master) => sum + master.width + MASTER_GAP / 2, 0)
  return { x, y: top - size.height - MASTER_GAP }
}

/**
 * Turns an existing page frame into a master page, its layers kept as the master's, as Affinity
 * Publisher's Convert to Master: it leaves the pages for the row of masters above them, and can
 * then be applied to any page. A master applied to it stays, nested. Returns the master.
 */
export function convertFrameToMaster(graph: SceneGraph, frame: SceneNode): SceneNode {
  if (frame.type !== 'FRAME') throw new Error('Only a frame becomes a master page')
  const canvas = canvasOf(graph, frame)
  if (!canvas) throw new Error('The frame is on no page')
  if (frame.parentId !== canvas.id) graph.reparentNode(frame.id, canvas.id)
  const place = nextMasterPlace(graph, canvas.id, frame)
  const taken = new Set(masterPages(graph, canvas.id).map((master) => master.name))
  graph.updateNode(frame.id, {
    type: 'COMPONENT',
    ...place,
    name: taken.has(frame.name) ? nextMasterName(graph, canvas.id) : frame.name,
    pluginData: withPluginData(frame.pluginData, LAWHA_PLUGIN_DATA.masterPage, { role: 'master' })
  })
  return graph.getNode(frame.id) ?? frame
}

/**
 * Detaches a page from its master, as Affinity Publisher's Detach from Master: the master's
 * layers become the page's own, unlocked, and stop following the master. False with no master.
 */
export function detachMasterPage(graph: SceneGraph, page: SceneNode): boolean {
  const applied = appliedMaster(graph, page)
  if (!applied) return false
  graph.detachInstance(applied.id)
  const detached = graph.getNode(applied.id)
  if (!detached) return false
  graph.updateNode(applied.id, {
    locked: false,
    pluginData: withPluginData(detached.pluginData, LAWHA_PLUGIN_DATA.masterPage, undefined)
  })
  return true
}

/**
 * Makes an empty master page the size of `size` (a page) on the canvas: a component whose layers
 * every page it is applied to shows behind its own, and follows when the master changes.
 */
export function createMasterPage(
  graph: SceneGraph,
  canvasId: string,
  size: { width: number; height: number },
  name = nextMasterName(graph, canvasId)
): SceneNode {
  const master = graph.createNode('COMPONENT', canvasId, {
    name,
    ...nextMasterPlace(graph, canvasId, size),
    width: size.width,
    height: size.height,
    fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1, visible: true }]
  })
  graph.updateNode(master.id, {
    pluginData: withPluginData(master.pluginData, LAWHA_PLUGIN_DATA.masterPage, {
      role: 'master'
    })
  })
  return master
}

/**
 * Shows `master` behind `page`'s own layers, replacing a master applied before: an instance of
 * it, locked and filling the page, at the bottom of the page. Returns the instance.
 */
export function applyMasterPage(graph: SceneGraph, master: SceneNode, page: SceneNode): SceneNode {
  if (!isMasterPage(master)) throw new Error(`${master.name} is not a master page`)
  if (page.type !== 'FRAME') throw new Error('A master is applied to a page frame')
  removeMasterPage(graph, page)
  const instance = graph.createInstance(master.id, page.id, {
    name: master.name,
    x: 0,
    y: 0,
    locked: true
  })
  if (!instance) throw new Error(`Could not place ${master.name}`)
  graph.updateNode(instance.id, {
    width: page.width,
    height: page.height,
    pluginData: withPluginData(instance.pluginData, LAWHA_PLUGIN_DATA.masterPage, {
      role: 'applied'
    })
  })
  graph.insertChildAt(instance.id, page.id, 0)
  return instance
}

/** Takes the master off a page; false when none was applied. */
export function removeMasterPage(graph: SceneGraph, page: SceneNode): boolean {
  const applied = appliedMaster(graph, page)
  if (!applied) return false
  graph.deleteNode(applied.id)
  return true
}

/** Marks a text as showing its page's number through `template`, then fills it in. */
export function makePageNumber(graph: SceneGraph, text: SceneNode, template = '{page}'): void {
  if (text.type !== 'TEXT') throw new Error('Only a text shows a page number')
  graph.updateNode(text.id, {
    pluginData: withPluginData(text.pluginData, LAWHA_PLUGIN_DATA.pageNumber, { template })
  })
}

/** The instances that hold `node`, innermost first, whose overrides keep what it shows. */
function enclosingInstances(graph: SceneGraph, node: SceneNode): SceneNode[] {
  const instances: SceneNode[] = []
  let current = node.parentId ? graph.getNode(node.parentId) : undefined
  while (current) {
    if (current.type === 'INSTANCE') instances.push(current)
    current = current.parentId ? graph.getNode(current.parentId) : undefined
  }
  return instances
}

/** Sets a text a publication fills in, keeping it as an override where it sits in an instance. */
function writeDerivedText(graph: SceneGraph, node: SceneNode, text: string) {
  graph.updateNode(node.id, { text, styleRuns: [] })
  for (const instance of enclosingInstances(graph, node)) {
    const overrides = cloneInstanceOverrideState(instance.instanceOverrides)
    setInstanceOverride(overrides, instance.id, node.id, 'text', text)
    graph.updateNode(instance.id, { instanceOverrides: overrides })
  }
}

/**
 * Fills every page number on a canvas page in: each with its page's place in reading order, and
 * `#` on a master page, as Affinity Publisher shows it there. Returns the texts written.
 */
export function refreshPageNumbers(graph: SceneGraph, canvasId: string): string[] {
  const pages = publicationPages(graph, canvasId)
  const { numberStart, numberFormat } = publicationSettings(graph, canvasId)
  const numbers = new Map(pages.map((page, index) => [page.id, index + numberStart]))
  const written: string[] = []
  for (const node of graph.getAllNodes()) {
    if (node.type !== 'TEXT') continue
    const field = readPluginData(node.pluginData, LAWHA_PLUGIN_DATA.pageNumber)
    if (!field || canvasOf(graph, node)?.id !== canvasId) continue
    const top = topLevelAncestor(graph, node)
    const page = numbers.get(top?.id ?? '') ?? null
    const text = formatPageNumber(field.template, page, pages.length, numberFormat)
    if (node.text === text) continue
    writeDerivedText(graph, node, text)
    written.push(node.id)
  }
  return written
}

/** Whether `text` fits `frame` at the frame's width and height, measured as layout measures. */
export function textFitsFrame(frame: SceneNode, text: string, runs: StyleRun[] = []): boolean {
  const size = measureTextForLayout(
    { ...frame, text, styleRuns: runs, textAutoResize: 'HEIGHT' },
    frame.width
  )
  return size.height <= frame.height + 0.5
}

/** Flows every story with a frame on the canvas page through its frames again. */
export function reflowStories(graph: SceneGraph, canvasId: string): string[] {
  const stories = new Set<string>()
  for (const node of graph.getAllNodes()) {
    const thread = threadOf(node)
    if (thread && canvasOf(graph, node)?.id === canvasId) stories.add(thread.story)
  }
  return [...stories].flatMap((story) => reflowThread(graph, story, textFitsFrame))
}

/** Whether a layer takes part in a publication: a master, page number, or threaded frame. */
export function isPublicationLayer(node: SceneNode): boolean {
  return (
    readPluginData(node.pluginData, LAWHA_PLUGIN_DATA.masterPage) !== undefined ||
    readPluginData(node.pluginData, LAWHA_PLUGIN_DATA.pageNumber) !== undefined ||
    threadOf(node) !== undefined
  )
}
