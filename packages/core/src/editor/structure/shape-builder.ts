import type { SceneGraph, SceneNode } from '@lawha/scene-graph'
import { getParentWorldMatrix } from '@lawha/scene-graph/coordinate'
import Matrix from '@lawha/scene-graph/matrix'
import type { Vector } from '@lawha/scene-graph/primitives'

import type { SkiaRenderer } from '#core/canvas'
import {
  SHAPE_BUILDER_MAX_LAYERS,
  canShapeBuild,
  disposeShapeBuilderPlan,
  planShapeBuilder,
  regionsAt,
  shapeBuilderRegions,
  vectorPropsForPath,
  type ShapeBuilderMode,
  type ShapeBuilderPlan
} from '#core/canvas/shape-builder'
import type { EditorContext } from '#core/editor/types'

import { inStackOrder } from './container-wrap'
import { selectedNodesInSharedParent } from './selection'
import { placeOf, recordLayerSwap, type LayerPlace } from './swap'

/** The layers Shape Builder works on: the selection, siblings that all have an area, bottom first. */
function shapeBuilderOperands(ctx: EditorContext, selectedNodes: SceneNode[]) {
  const selection = selectedNodesInSharedParent(ctx, selectedNodes)
  if (!selection || selection.topLevel.length > SHAPE_BUILDER_MAX_LAYERS) return null
  if (selection.topLevel.some((node) => !canShapeBuild(node, ctx.graph))) return null
  const nodes = inStackOrder(ctx.graph, selection.topLevel, selection.parentId)
  return { nodes, parentId: selection.parentId, parent: selection.parent }
}

/** Canvas points in the coordinates of `parentId`, where the operands' regions are. */
function pointsInParent(ctx: EditorContext, parentId: string, points: readonly Vector[]) {
  const parent = ctx.graph.getNode(parentId)
  const inverse = Matrix.invert(getParentWorldMatrix(parent, ctx.graph))
  if (!inverse) return []
  return points.map((point) => Matrix.mapPoint(inverse, point))
}

/**
 * The outlines of the regions under `points` (canvas coordinates) as SVG path data in canvas
 * coordinates, for the Shape Builder tool to highlight what a release would merge or delete.
 */
export function shapeBuilderHighlight(
  ctx: EditorContext,
  selectedNodes: SceneNode[],
  points: readonly Vector[]
): string[] {
  const renderer = ctx.getRenderer()
  const operands = renderer ? shapeBuilderOperands(ctx, selectedNodes) : null
  if (!renderer || !operands) return []
  const regions = shapeBuilderRegions(renderer, ctx.graph, operands.nodes)
  try {
    const world = getParentWorldMatrix(operands.parent, ctx.graph)
    return regionsAt(regions, pointsInParent(ctx, operands.parentId, points)).map((region) =>
      worldPathData(renderer, region.path, world)
    )
  } finally {
    for (const region of regions) region.path.delete()
  }
}

function worldPathData(
  renderer: SkiaRenderer,
  path: Parameters<typeof vectorPropsForPath>[1],
  world: number[]
) {
  const builder = new renderer.ck.PathBuilder()
  builder.addPath(path, world)
  const placed = builder.detachAndDelete()
  const data = placed.toSVGString()
  placed.delete()
  return data
}

/**
 * Illustrator's Shape Builder over the selected sibling shapes: the regions under `points`
 * (canvas coordinates, in the order the drag reached them) merge into one shape painted like the
 * first, or are cut away with `delete`. Every layer they touch keeps the rest of its area as a
 * vector in its place; a layer left with nothing is removed. Returns the layers made, or null
 * when no region was picked.
 */
export function shapeBuilderSelected(
  ctx: EditorContext,
  selectedNodes: SceneNode[],
  points: readonly Vector[],
  mode: ShapeBuilderMode = 'merge'
): string[] | null {
  const renderer = ctx.getRenderer()
  const operands = renderer ? shapeBuilderOperands(ctx, selectedNodes) : null
  if (!renderer || !operands) return null
  const local = pointsInParent(ctx, operands.parentId, points)
  const plan = planShapeBuilder(renderer, ctx.graph, operands.nodes, local, mode)
  if (!plan) return null
  try {
    const prevSelection = new Set(ctx.state.selectedIds)
    const removed: LayerPlace[] = plan.remains.flatMap(({ node }) => placeOf(ctx, node.id) ?? [])
    const madeIds = applyShapeBuilderPlan(ctx.graph, renderer, operands.parentId, plan)
    recordLayerSwap(
      ctx,
      mode === 'merge' ? 'Shape Builder merge' : 'Shape Builder delete',
      removed,
      madeIds,
      prevSelection
    )
    return madeIds
  } finally {
    disposeShapeBuilderPlan(plan)
  }
}

/**
 * Writes a Shape Builder plan into the graph: every touched layer becomes a vector of what is
 * left of it in its place, or goes when nothing is, and the merge lands just above what is left of
 * the topmost layer it took from. Returns the layers made, bottom first.
 */
export function applyShapeBuilderPlan(
  graph: SceneGraph,
  renderer: SkiaRenderer,
  parentId: string,
  plan: ShapeBuilderPlan
): string[] {
  const madeIds: string[] = []
  let mergeIndex = 0
  for (const { node, path } of plan.remains) {
    const index = graph.getNode(parentId)?.childIds.indexOf(node.id) ?? 0
    mergeIndex = index
    if (path) {
      const kept = graph.createNode('VECTOR', parentId, vectorPropsForPath(renderer, path, node))
      graph.insertChildAt(kept.id, parentId, index)
      madeIds.push(kept.id)
      mergeIndex = index + 1
    }
    graph.deleteNode(node.id)
  }
  if (plan.merged) {
    const { path, style } = plan.merged
    const merged = graph.createNode('VECTOR', parentId, vectorPropsForPath(renderer, path, style))
    graph.insertChildAt(merged.id, parentId, mergeIndex)
    madeIds.push(merged.id)
  }
  return madeIds
}
