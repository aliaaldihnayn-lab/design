import type { SceneGraph, SceneNode } from '@lawha/scene-graph'
import { getNodeLocalMatrix } from '@lawha/scene-graph/coordinate'
import type { Rect, Vector } from '@lawha/scene-graph/primitives'

import {
  mapContours,
  meshFunction,
  warpFunction,
  warpStep,
  type EnvelopeMesh,
  type WarpOptions
} from '#core/vector/warp'

import { canMakeBooleanSourceNode, flattenSourcePath, placedPath } from './boolean'
import { cubicsToPath, pathToCubics } from './paths/cubic'
import type { SkiaRenderer } from './renderer'
import { vectorPropsForPath } from './shape-builder'

/** Layers a warp or envelope reshapes: anything with an outline, not containers. */
const WARPABLE_TYPES = new Set<SceneNode['type']>([
  'RECTANGLE',
  'ROUNDED_RECTANGLE',
  'ELLIPSE',
  'POLYGON',
  'STAR',
  'LINE',
  'VECTOR',
  'TEXT',
  'BOOLEAN_OPERATION'
])

export function canWarp(node: SceneNode, graph: SceneGraph): boolean {
  return WARPABLE_TYPES.has(node.type) && canMakeBooleanSourceNode(node, graph)
}

/** The box a layer's outline takes in its parent, which a warp or mesh is laid over. */
export function warpBox(r: SkiaRenderer, node: SceneNode, graph: SceneGraph): Rect | null {
  const own = flattenSourcePath(r, node, graph)
  if (!own) return null
  const placed = placedPath(r, own, getNodeLocalMatrix(node))
  own.delete()
  const [left, top, right, bottom] = placed.computeTightBounds()
  placed.delete()
  return { x: left, y: top, width: right - left, height: bottom - top }
}

/**
 * The vector a layer becomes when every point of its outline, in its parent's coordinates, is
 * moved by the map `makeMap` gives for its box: the outline is cut fine first so straight edges
 * bend. The vector keeps the layer's name, paint, stroke, and effects.
 */
export function remappedVectorProps(
  r: SkiaRenderer,
  graph: SceneGraph,
  node: SceneNode,
  makeMap: (box: Rect) => (point: Vector) => Vector
): Partial<SceneNode> | null {
  if (!canWarp(node, graph)) return null
  const own = flattenSourcePath(r, node, graph)
  if (!own) return null
  const placed = placedPath(r, own, getNodeLocalMatrix(node))
  own.delete()
  try {
    const [left, top, right, bottom] = placed.computeTightBounds()
    const box = { x: left, y: top, width: right - left, height: bottom - top }
    if (box.width <= 0 && box.height <= 0) return null
    const contours = mapContours(pathToCubics(r.ck, placed), makeMap(box), warpStep(box))
    const warped = cubicsToPath(r.ck, contours, placed.getFillType())
    try {
      return vectorPropsForPath(r, warped, node)
    } finally {
      warped.delete()
    }
  } finally {
    placed.delete()
  }
}

/** The vector a warp preset makes of a layer. */
export function warpedVectorProps(
  r: SkiaRenderer,
  graph: SceneGraph,
  node: SceneNode,
  options: WarpOptions
): Partial<SceneNode> | null {
  return remappedVectorProps(r, graph, node, (box) => warpFunction(box, options))
}

/**
 * The vector an envelope mesh makes of a layer. The mesh's points are where the grid laid over
 * the layer's box went, in the parent's coordinates; a mesh of another size is refused.
 */
export function meshedVectorProps(
  r: SkiaRenderer,
  graph: SceneGraph,
  node: SceneNode,
  mesh: EnvelopeMesh
): Partial<SceneNode> | null {
  if (mesh.points.length !== (mesh.rows + 1) * (mesh.columns + 1)) return null
  return remappedVectorProps(r, graph, node, (box) => meshFunction(box, mesh))
}
