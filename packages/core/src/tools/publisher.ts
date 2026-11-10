import * as v from 'valibot'

import type { SceneGraph, SceneNode } from '@lawha/scene-graph'

import {
  applyMasterPage as applyMaster,
  canvasOf,
  createMasterPage as createMaster,
  isMasterPage,
  linkTextFrames,
  makePageNumber,
  reflowStories,
  refreshPageNumbers,
  removeMasterPage,
  unlinkTextFrame
} from '#core/publisher'
import { defineTool, nodeIdInputSchema } from '#core/tools/schema'

/** Page numbers and threaded text follow the edit, as the editor keeps them. */
function refresh(graph: SceneGraph, node: SceneNode) {
  const canvas = canvasOf(graph, node)
  if (!canvas) return
  refreshPageNumbers(graph, canvas.id)
  reflowStories(graph, canvas.id)
}

export const createMasterPageTool = defineTool({
  name: 'create_master_page',
  description:
    "Add a master page, as in Affinity Publisher: a component above the pages whose layers show behind every page it is applied to and follow when it changes. Pages are the frames placed directly on the canvas, numbered in reading order. Sized like page_id's page (A4, 794 × 1123, without). Add its shared layers (header, footer, page number) as its children, then apply_master_page.",
  execution: { kind: 'sync', mutation: 'document' },
  input: v.strictObject({
    page_id: v.optional(nodeIdInputSchema),
    name: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(100)))
  }),
  execute: (figma, args) => {
    const graph = figma.graph
    const page = args.page_id ? graph.getNode(args.page_id) : undefined
    if (args.page_id && !page) return { error: `Node ${args.page_id} not found` }
    const canvasId = page ? canvasOf(graph, page)?.id : figma.currentPageId
    if (!canvasId) return { error: 'That layer is on no page' }
    const size = page ? { width: page.width, height: page.height } : { width: 794, height: 1123 }
    const master = createMaster(graph, canvasId, size, args.name)
    return { id: master.id, name: master.name }
  }
})

export const applyMasterPageTool = defineTool({
  name: 'apply_master_page',
  description:
    'Apply a master page to pages (frames on the canvas): each shows the master behind its own layers as a locked instance, replacing any master applied before. remove: true takes the master off instead.',
  execution: { kind: 'sync', mutation: 'document' },
  input: v.strictObject({
    master_id: v.optional(nodeIdInputSchema),
    page_ids: v.pipe(v.array(nodeIdInputSchema), v.minLength(1)),
    remove: v.optional(v.boolean(), false)
  }),
  execute: (figma, args) => {
    const graph = figma.graph
    const master = args.master_id ? graph.getNode(args.master_id) : undefined
    if (!args.remove && !isMasterPage(master)) return { error: 'master_id is not a master page' }
    const done: string[] = []
    for (const id of args.page_ids) {
      const page = graph.getNode(id)
      if (page?.type !== 'FRAME') return { error: `${id} is not a page frame` }
      if (args.remove) {
        removeMasterPage(graph, page)
      } else if (master) applyMaster(graph, master, page)
      done.push(id)
      refresh(graph, page)
    }
    return { pages: done }
  }
})

export const insertPageNumberTool = defineTool({
  name: 'set_page_number',
  description:
    "Make a text show its page's number, as Affinity Publisher's page number field: {page} in template becomes the number of the page (canvas frame, in reading order) the text is on and {pages} the page count; on a master page it shows #. Put one on a master to number every page it is applied to. Numbers update as pages are added, removed or moved.",
  execution: { kind: 'sync', mutation: 'document' },
  input: v.strictObject({
    id: nodeIdInputSchema,
    template: v.optional(v.pipe(v.string(), v.maxLength(200)), '{page}')
  }),
  execute: (figma, args) => {
    const node = figma.graph.getNode(args.id)
    if (node?.type !== 'TEXT') return { error: `${args.id} is not a text` }
    makePageNumber(figma.graph, node, args.template)
    refresh(figma.graph, node)
    return { id: node.id, text: figma.graph.getNode(node.id)?.text }
  }
})

export const linkTextFramesTool = defineTool({
  name: 'link_text_frames',
  description:
    "Thread text frames into one story, as Affinity Publisher links frames: text that overflows a frame runs on into the next, in the order given, and flows back as text is removed. The frames become fixed size; the story takes the first frame's style. unlink: true takes each frame out of its story instead, its text going back to the frames left.",
  execution: { kind: 'sync', mutation: 'document' },
  input: v.strictObject({
    ids: v.pipe(v.array(nodeIdInputSchema), v.minLength(1)),
    unlink: v.optional(v.boolean(), false)
  }),
  execute: (figma, args) => {
    const graph = figma.graph
    const frames = args.ids.map((id) => graph.getNode(id))
    const missing = args.ids.find((_, i) => frames[i]?.type !== 'TEXT')
    if (missing) return { error: `${missing} is not a text frame` }
    const texts = frames.filter((frame): frame is SceneNode => !!frame)
    if (args.unlink) {
      for (const frame of texts) unlinkTextFrame(graph, graph.getNode(frame.id) ?? frame)
      refresh(graph, texts[0])
      return { unlinked: texts.length }
    }
    if (texts.length < 2) return { error: 'Link at least two frames' }
    let story = ''
    try {
      for (let i = 1; i < texts.length; i++) {
        story = linkTextFrames(graph, graph.getNode(texts[i - 1].id) ?? texts[i - 1], texts[i])
      }
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
    refresh(graph, texts[0])
    return {
      story,
      frames: texts.map((frame) => ({ id: frame.id, text: graph.getNode(frame.id)?.text }))
    }
  }
})
