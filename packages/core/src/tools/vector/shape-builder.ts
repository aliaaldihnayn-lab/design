import type { Path } from 'canvaskit-wasm'
import * as v from 'valibot'

import type { SceneNode } from '@lawha/scene-graph'
import { getParentWorldMatrix } from '@lawha/scene-graph/coordinate'
import Matrix from '@lawha/scene-graph/matrix'
import type { Vector } from '@lawha/scene-graph/primitives'

import {
  SHAPE_BUILDER_MAX_LAYERS,
  canShapeBuild,
  disposeShapeBuilderPlan,
  planShapeBuilder,
  shapeBuilderRegions
} from '#core/canvas/shape-builder'
import { inStackOrder } from '#core/editor/structure/container-wrap'
import { applyShapeBuilderPlan } from '#core/editor/structure/shape-builder'
import type { FigmaAPI } from '#core/figma-api'
import { measuringRenderer } from '#core/figma-api/measure'
import { defineTool } from '#core/tools/schema'

const NO_RENDERER = 'Shape Builder needs path geometry, which this host cannot measure'

const idsSchema = v.pipe(
  v.array(v.string()),
  v.minLength(1),
  v.maxLength(SHAPE_BUILDER_MAX_LAYERS),
  v.description(
    'Sibling shapes to divide (rectangles, ellipses, polygons, stars, vectors, text, booleans)'
  )
)

/** The shapes, siblings in one parent, bottom first; or why they cannot be divided. */
function operands(figma: FigmaAPI, ids: readonly string[]) {
  const nodes = ids.map((id) => figma.graph.getNode(id))
  if (nodes.some((node) => !node)) return { error: 'One or more node IDs were not found' }
  const found = nodes.filter((node): node is SceneNode => node !== undefined)
  const parentId = found[0].parentId
  if (!parentId || found.some((node) => node.parentId !== parentId))
    return { error: 'The shapes must share one parent' }
  if (found.some((node) => !canShapeBuild(node, figma.graph)))
    return { error: 'Shape Builder works on shapes, vectors, text, and boolean operations' }
  return { nodes: inStackOrder(figma.graph, found, parentId), parentId }
}

/** A point inside `path`: its box's centre when that is inside, else the first grid point that is. */
function pointInside(path: Path): Vector | null {
  const [left, top, right, bottom] = path.getBounds()
  for (let steps = 1; steps <= 32; steps *= 2) {
    for (let i = 0; i < steps; i++) {
      for (let j = 0; j < steps; j++) {
        const x = left + ((i + 0.5) / steps) * (right - left)
        const y = top + ((j + 0.5) / steps) * (bottom - top)
        if (path.contains(x, y)) return { x, y }
      }
    }
  }
  return null
}

const round = (n: number) => Math.round(n * 100) / 100

export const shapeBuilderRegionsTool = defineTool({
  name: 'shape_builder_regions',
  description:
    "List the regions Illustrator's Shape Builder divides overlapping sibling shapes into: each connected area covered by the same shapes, with its bounds and a point inside it, in absolute canvas coordinates. Pass those points to shape_builder.",
  execution: { kind: 'sync', mutation: 'none' },
  input: v.strictObject({ ids: idsSchema }),
  execute: (figma, { ids }) => {
    const renderer = measuringRenderer(figma)
    if (!renderer) return { error: NO_RENDERER }
    const found = operands(figma, ids)
    if ('error' in found) return found
    const world = getParentWorldMatrix(figma.graph.getNode(found.parentId), figma.graph)
    const regions = shapeBuilderRegions(renderer, figma.graph, found.nodes)
    try {
      return {
        regions: regions.map((region, index) => {
          const [left, top, right, bottom] = region.path.getBounds()
          const [x1, y1, x2, y2] = Matrix.mapPoints(world, [left, top, right, bottom])
          const inside = pointInside(region.path)
          const point = inside ? Matrix.mapPoint(world, inside) : null
          return {
            index,
            covered_by: region.owners.map((owner) => found.nodes[owner].id),
            bounds: { x: round(x1), y: round(y1), width: round(x2 - x1), height: round(y2 - y1) },
            point: point ? { x: round(point.x), y: round(point.y) } : null
          }
        })
      }
    } finally {
      for (const region of regions) region.path.delete()
    }
  }
})

export const shapeBuilder = defineTool({
  name: 'shape_builder',
  description:
    "Illustrator's Shape Builder on overlapping sibling shapes: merge the regions under the given points (absolute canvas coordinates; see shape_builder_regions) into one shape painted like the first region's topmost shape, or delete them. Every shape a region touches keeps the rest of its area as a vector in its place.",
  execution: { kind: 'sync', mutation: 'document' },
  input: v.strictObject({
    ids: idsSchema,
    points: v.pipe(
      v.array(v.strictObject({ x: v.number(), y: v.number() })),
      v.minLength(1),
      v.maxLength(256),
      v.description('Points inside the regions to merge or delete, in absolute canvas coordinates')
    ),
    mode: v.optional(v.picklist(['merge', 'delete']), 'merge')
  }),
  execute: (figma, { ids, points, mode }) => {
    const renderer = measuringRenderer(figma)
    if (!renderer) return { error: NO_RENDERER }
    const found = operands(figma, ids)
    if ('error' in found) return found
    const parent = figma.graph.getNode(found.parentId)
    const inverse = Matrix.invert(getParentWorldMatrix(parent, figma.graph))
    if (!inverse) return { error: 'The parent cannot be inverted' }
    const local = points.map((point) => Matrix.mapPoint(inverse, point))
    const plan = planShapeBuilder(renderer, figma.graph, found.nodes, local, mode)
    if (!plan) return { error: 'No region lies under the given points' }
    try {
      const made = applyShapeBuilderPlan(figma.graph, renderer, found.parentId, plan)
      return {
        removed: plan.remains.map(({ node }) => node.id),
        created: made.map((id) => ({ id, name: figma.graph.getNode(id)?.name ?? '' }))
      }
    } finally {
      disposeShapeBuilderPlan(plan)
    }
  }
})
