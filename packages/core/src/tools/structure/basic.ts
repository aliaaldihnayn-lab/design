import * as v from 'valibot'

import { canvasOf, reflowStories } from '#core/publisher'
import {
  toolNumber,
  nodeIdInputSchema,
  nodeInputSchema,
  defineTool,
  nodeNotFound,
  nodeSummary
} from '#core/tools/schema'

export const deleteNode = defineTool({
  name: 'delete_node',

  description:
    'Delete a node by ID. A threaded text frame (or a layer holding one) gives its text back to the frames left in its story, which flow it on.',
  execution: { kind: 'sync', mutation: 'document' },
  input: v.strictObject({
    id: v.pipe(v.string(), v.description('Node ID to delete'))
  }),
  execute: (figma, { id }) => {
    const node = figma.getNodeById(id)
    if (!node) return { error: `Node "${id}" not found` }
    const raw = figma.graph.getNode(id)
    const canvas = raw ? canvasOf(figma.graph, raw) : undefined
    node.remove()
    if (canvas) reflowStories(figma.graph, canvas.id)
    return { deleted: id }
  }
})

export const cloneNode = defineTool({
  name: 'clone_node',

  description: 'Clone (duplicate) a node.',
  execution: { kind: 'sync', mutation: 'document' },
  input: v.strictObject({
    id: v.pipe(v.string(), v.description('Node ID to clone'))
  }),
  execute: (figma, { id }) => {
    const node = figma.getNodeById(id)
    if (!node) return { error: `Node "${id}" not found` }
    const clone = node.clone()
    return nodeSummary(clone)
  }
})

export const renameNode = defineTool({
  name: 'rename_node',

  description: 'Rename a node in the layers panel.',
  execution: { kind: 'sync', mutation: 'document' },
  input: v.strictObject({
    id: nodeIdInputSchema,
    name: v.pipe(v.string(), v.description('New name'))
  }),
  execute: (figma, { id, name }) => {
    const node = figma.getNodeById(id)
    if (!node) return { error: `Node "${id}" not found` }
    node.name = name
    return { id, name }
  }
})

export const nodeBounds = defineTool({
  name: 'node_bounds',
  description: 'Get absolute bounding box of a node.',
  execution: { kind: 'sync', mutation: 'none' },
  exposure: { webmcp: false },
  input: nodeInputSchema,
  execute: (figma, { id }) => {
    const node = figma.getNodeById(id)
    return node ? { id, bounds: node.absoluteBoundingBox } : nodeNotFound(id)
  }
})

export const nodeMove = defineTool({
  name: 'node_move',

  description: 'Move a node to new coordinates.',
  execution: { kind: 'sync', mutation: 'document' },
  input: v.strictObject({
    id: nodeIdInputSchema,
    x: toolNumber(v.pipe(v.number(), v.description('X position'))),
    y: toolNumber(v.pipe(v.number(), v.description('Y position')))
  }),
  execute: (figma, { id, x, y }) => {
    const node = figma.getNodeById(id)
    if (!node) return nodeNotFound(id)
    node.x = x
    node.y = y
    return { id, x, y }
  }
})

export const nodeResize = defineTool({
  name: 'node_resize',

  description: 'Resize a node.',
  execution: { kind: 'sync', mutation: 'document' },
  input: v.strictObject({
    id: nodeIdInputSchema,
    width: toolNumber(v.pipe(v.number(), v.minValue(1), v.description('Width'))),
    height: toolNumber(v.pipe(v.number(), v.minValue(1), v.description('Height')))
  }),
  execute: (figma, { id, width, height }) => {
    const node = figma.getNodeById(id)
    if (!node) return nodeNotFound(id)
    node.resize(width, height)
    return { id, width, height }
  }
})
