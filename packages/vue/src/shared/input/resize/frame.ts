import type { SceneGraph, SceneNode } from '@lawha/scene-graph'
import { getNodeLocalMatrix, getParentWorldMatrix } from '@lawha/scene-graph/coordinate'
import Matrix, { type Mat3 } from '@lawha/scene-graph/matrix'
import type { Rect, Vector } from '@lawha/scene-graph/primitives'

const EPSILON = 1e-9

/**
 * The layer's own frame as the drag found it, when it is turned or reflected on the canvas (by
 * itself or a parent): a handle drag then sizes the layer along its own axes, not the canvas's.
 * Null for a layer whose axes are the canvas's, which resizes by the pointer's canvas delta.
 */
export function turnedResizeFrame(
  node: SceneNode,
  origRect: Rect,
  graph: Pick<SceneGraph, 'getNode' | 'rootId'>
): Mat3 | null {
  const parent = node.parentId ? graph.getNode(node.parentId) : undefined
  const world = Matrix.multiply(
    getParentWorldMatrix(parent, graph),
    getNodeLocalMatrix({ ...node, ...origRect })
  )
  const aligned =
    Math.abs(world[0] - 1) <= EPSILON &&
    Math.abs(world[4] - 1) <= EPSILON &&
    Math.abs(world[1]) <= EPSILON &&
    Math.abs(world[3]) <= EPSILON
  return aligned ? null : world
}

/** How far the pointer moved from `start` to `end`, along the layer's own axes. */
export function deltaInFrame(frame: Mat3, start: Vector, end: Vector): Vector {
  const inverse = Matrix.invert(frame)
  if (!inverse) return { x: end.x - start.x, y: end.y - start.y }
  const from = Matrix.mapPoint(inverse, start)
  const to = Matrix.mapPoint(inverse, end)
  return { x: to.x - from.x, y: to.y - from.y }
}

/**
 * Where a turned or reflected layer sits once resized to `local`, a box given in its starting
 * frame offset by `origRect`'s position: the edges the handle leaves alone stay where they were
 * drawn, as in Figma, though the layer turns about its new centre.
 */
export function placeResizedInFrame(
  node: Pick<SceneNode, 'type' | 'rotation' | 'flipX' | 'flipY'>,
  origRect: Rect,
  local: Rect
): Rect {
  const start = getNodeLocalMatrix({ ...node, ...origRect })
  const corner = Matrix.mapPoint(start, { x: local.x - origRect.x, y: local.y - origRect.y })
  const resized = getNodeLocalMatrix({
    ...node,
    x: 0,
    y: 0,
    width: local.width,
    height: local.height
  })
  const offset = Matrix.mapPoint(resized, { x: 0, y: 0 })
  return {
    x: corner.x - offset.x,
    y: corner.y - offset.y,
    width: local.width,
    height: local.height
  }
}
