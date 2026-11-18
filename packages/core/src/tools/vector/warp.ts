import * as v from 'valibot'

import type { SceneNode } from '@lawha/scene-graph'
import { WARP_PRESETS } from '@lawha/scene-graph/path-effects'

import { applyLiveEffect } from '#core/canvas/live-effects'
import { canWarp, meshedVectorProps, warpBox, warpedVectorProps } from '#core/canvas/warp'
import { replaceWithVector } from '#core/editor/structure/swap'
import type { FigmaAPI } from '#core/figma-api'
import { measuringRenderer } from '#core/figma-api/measure'
import { defineTool } from '#core/tools/schema'
import { layerIdsSchema, meshCellCountSchema, meshMoveSchema } from '#core/tools/vector/schema'
import { flatMesh, flatMeshPoints } from '#core/vector/warp'

const NO_RENDERER = 'Warping needs path geometry, which this host cannot measure'

const amountSchema = (description: string) =>
  v.optional(v.pipe(v.number(), v.minValue(-1), v.maxValue(1), v.description(description)))

/** The layers to reshape, or why one cannot be. */
function warpable(figma: FigmaAPI, ids: readonly string[]) {
  const nodes: SceneNode[] = []
  for (const id of ids) {
    const node = figma.graph.getNode(id)
    if (!node) return { error: `Node ${id} not found` }
    if (!canWarp(node, figma.graph))
      return { error: `${node.name} has no outline to warp (shapes, vectors, text, booleans)` }
    nodes.push(node)
  }
  return { nodes }
}

/** Replaces each layer by the vector `reshape` makes of it, in its place. */
function reshapeAll(
  figma: FigmaAPI,
  nodes: readonly SceneNode[],
  reshape: (node: SceneNode) => Partial<SceneNode> | null
) {
  const created: { id: string; name: string; source: string }[] = []
  for (const node of nodes) {
    const props = reshape(node)
    if (!props) continue
    const id = replaceWithVector(figma.graph, node, props)
    if (id) created.push({ id, name: node.name, source: node.id })
  }
  if (created.length === 0) return { error: 'Nothing could be warped' }
  return { created }
}

export const warpShape = defineTool({
  name: 'warp_shape',
  description: `Bend layers with one of Illustrator's Warp presets (${WARP_PRESETS.join(', ')}), as Object → Envelope Distort → Make with Warp: each layer becomes a vector of its warped outline, keeping its paint, stroke and effects. The warp stays live (edit it with edit_path_effect, expand or release it with expand_path_effect or release_path_effect) unless expand is true. bend, horizontal and vertical distortion run from -1 to 1 (Illustrator's -100%…100%).`,
  execution: { kind: 'sync', mutation: 'document' },
  input: v.strictObject({
    ids: v.pipe(layerIdsSchema, v.description('Layers to warp')),
    preset: v.picklist(WARP_PRESETS),
    bend: v.pipe(v.number(), v.minValue(-1), v.maxValue(1), v.description('Bend, -1…1')),
    horizontal: amountSchema('Horizontal distortion, -1…1'),
    vertical: amountSchema('Vertical distortion, -1…1'),
    direction: v.optional(v.picklist(['horizontal', 'vertical']), 'horizontal'),
    expand: v.optional(v.pipe(v.boolean(), v.description('Expand at once: no live warp')), false)
  }),
  execute: (figma, args) => {
    const renderer = measuringRenderer(figma)
    if (!renderer) return { error: NO_RENDERER }
    const found = warpable(figma, args.ids)
    if ('error' in found) return found
    const options = {
      preset: args.preset,
      bend: args.bend,
      horizontal: args.horizontal ?? 0,
      vertical: args.vertical ?? 0,
      vertically: args.direction === 'vertical'
    }
    return reshapeAll(figma, found.nodes, (node) =>
      args.expand
        ? warpedVectorProps(renderer, figma.graph, node, options)
        : applyLiveEffect(renderer, figma.graph, node, { kind: 'warp', ...options })
    )
  }
})

export const envelopeMesh = defineTool({
  name: 'envelope_mesh',
  description:
    "Distort a layer with an envelope mesh, as Illustrator's Object → Envelope Distort → Make with Mesh: a rows×columns grid is laid over the layer's box and the given grid points move by dx, dy (pixels); everything between follows. Row 0 is the top edge, column 0 the left edge; the grid has rows+1 by columns+1 points. The mesh stays live (edit_path_effect moves its points and handles, adds rows and columns) unless expand is true.",
  execution: { kind: 'sync', mutation: 'document' },
  input: v.strictObject({
    id: v.string(),
    rows: meshCellCountSchema,
    columns: meshCellCountSchema,
    moves: v.optional(
      v.pipe(
        v.array(meshMoveSchema),
        v.description('Grid points to move; none lays a flat mesh to edit later')
      ),
      []
    ),
    expand: v.optional(v.pipe(v.boolean(), v.description('Expand at once: no live mesh')), false)
  }),
  execute: (figma, { id, rows, columns, moves, expand }) => {
    const renderer = measuringRenderer(figma)
    if (!renderer) return { error: NO_RENDERER }
    const found = warpable(figma, [id])
    if ('error' in found) return found
    const [node] = found.nodes
    const box = warpBox(renderer, node, figma.graph)
    if (!box) return { error: `${node.name} has no outline to warp` }
    const mesh = flatMesh(box, rows, columns)
    const unit = flatMeshPoints(rows, columns)
    for (const move of moves) {
      if (move.row > rows || move.column > columns)
        return {
          error: `Grid point ${move.row},${move.column} is outside a ${rows}×${columns} mesh`
        }
      const point = mesh.points[move.row * (columns + 1) + move.column]
      mesh.points[move.row * (columns + 1) + move.column] = {
        x: point.x + move.dx,
        y: point.y + move.dy
      }
      const cell = unit[move.row * (columns + 1) + move.column]
      unit[move.row * (columns + 1) + move.column] = {
        x: cell.x + move.dx / Math.max(box.width, 1e-9),
        y: cell.y + move.dy / Math.max(box.height, 1e-9)
      }
    }
    return reshapeAll(figma, [node], (target) =>
      expand
        ? meshedVectorProps(renderer, figma.graph, target, mesh)
        : applyLiveEffect(renderer, figma.graph, target, {
            kind: 'mesh',
            rows,
            columns,
            points: unit
          })
    )
  }
})
