import type {
  BezierPath,
  BooleanOperation as PSDBooleanOperation,
  KeyDescriptorItem,
  Layer,
  VectorContent
} from 'ag-psd'

import type { Fill, SceneGraph, SceneNode, Stroke } from '@lawha/scene-graph'
import { fitEnclosingGroups } from '@lawha/scene-graph/group-bounds'
import { parseSVGPath } from '@lawha/scene-graph/parse-path'
import { transformVectorNetwork } from '@lawha/scene-graph/vector-network'

import { createBooleanOperation, type BooleanOperation } from '#core/editor/structure/boolean'
import { computeAccurateBounds } from '#core/vector/curve-math'

import { psdColor, psdGradientFill } from './color'
import type { PatternFill } from './effects'

/**
 * Photoshop shape and fill layers as editable layers: a rectangle, rounded rectangle or ellipse
 * where the shape tool drew one, a boolean group of its paths where they combine by subtracting,
 * intersecting or excluding, else a vector of the layer's path, with its fill (colour, gradient
 * or pattern) and stroke. A fill layer without a path covers the canvas.
 */

/** Photoshop's `keyOriginType` for the live shapes it can redraw. */
const ORIGIN_RECT = 1
const ORIGIN_ROUNDED_RECT = 2
const ORIGIN_ELLIPSE = 5

const round = (value: number) => Math.round(value * 100) / 100

function contentPaint(
  content: VectorContent | undefined,
  opacity: number,
  patternFill?: PatternFill
): Fill | null {
  if (!content) return null
  if (content.type === 'color') {
    return { type: 'SOLID', color: psdColor(content.color), opacity, visible: true }
  }
  if (content.type === 'solid' || content.type === 'noise') {
    return psdGradientFill(content, content.style, content.angle, opacity)
  }
  return patternFill?.(content, (content.scale ?? 100) / 100, opacity) ?? null
}

/**
 * Whether a fill or shape layer can be redrawn as an editable layer; a pattern only when the
 * document holds its pixels.
 */
export function isEditableShapeLayer(layer: Layer, patternFill?: PatternFill): boolean {
  if (!layer.vectorFill && !layer.vectorStroke?.strokeEnabled) return false
  const fill = layer.vectorStroke?.fillEnabled === false ? null : layer.vectorFill
  return !fill || contentPaint(fill, 1, patternFill) !== null
}

function layerFills(layer: Layer, patternFill?: PatternFill): Fill[] {
  if (layer.vectorStroke?.fillEnabled === false) return []
  const fill = contentPaint(layer.vectorFill, layer.fillOpacity ?? 1, patternFill)
  return fill ? [fill] : []
}

const ALIGN = { inside: 'INSIDE', center: 'CENTER', outside: 'OUTSIDE' } as const
const CAPS = { butt: 'NONE', round: 'ROUND', square: 'SQUARE' } as const
const JOINS = { miter: 'MITER', round: 'ROUND', bevel: 'BEVEL' } as const

function layerStrokes(layer: Layer): Stroke[] {
  const stroke = layer.vectorStroke
  if (!stroke?.strokeEnabled) return []
  const paint = contentPaint(stroke.content, (stroke.opacity ?? 1) * (layer.fillOpacity ?? 1))
  if (!paint) return []
  const weight = stroke.lineWidth?.value ?? 1
  const result: Stroke = {
    ...paint,
    weight,
    align: ALIGN[stroke.lineAlignment ?? 'center'],
    cap: CAPS[stroke.lineCapType ?? 'butt'],
    join: JOINS[stroke.lineJoinType ?? 'miter']
  }
  // Photoshop's dashes are in multiples of the line width.
  const dashes = (stroke.lineDashSet ?? []).map((dash) => dash.value * weight)
  if (dashes.length > 0) result.dashPattern = dashes
  return [result]
}

/** A path's subpaths as SVG path data, in document pixels. */
function pathData(paths: readonly BezierPath[]): string {
  const parts: string[] = []
  const p = (x: number, y: number) => `${round(x)} ${round(y)}`
  for (const path of paths) {
    const knots = path.knots
    if (knots.length === 0) continue
    parts.push(`M${p(knots[0].points[2], knots[0].points[3])}`)
    const count = path.open ? knots.length - 1 : knots.length
    for (let i = 0; i < count; i++) {
      const from = knots[i].points
      const to = knots[(i + 1) % knots.length].points
      parts.push(`C${p(from[4], from[5])} ${p(to[0], to[1])} ${p(to[2], to[3])}`)
    }
    if (!path.open) parts.push('Z')
  }
  return parts.join('')
}

/** The live shape the shape tool drew, when it is still an upright one. */
function liveShape(origination: KeyDescriptorItem | undefined) {
  const type = origination?.keyOriginType
  const box = origination?.keyOriginShapeBoundingBox
  if (!box || (type !== ORIGIN_RECT && type !== ORIGIN_ROUNDED_RECT && type !== ORIGIN_ELLIPSE))
    return null
  const transform = origination.transform
  const upright =
    !transform ||
    (Math.abs(transform[1]) < 1e-6 &&
      Math.abs(transform[2]) < 1e-6 &&
      transform[0] > 0 &&
      transform[3] > 0)
  if (!upright) return null
  const radii = origination.keyOriginRRectRadii
  return {
    type,
    x: box.left.value,
    y: box.top.value,
    width: box.right.value - box.left.value,
    height: box.bottom.value - box.top.value,
    radii: radii
      ? [radii.topLeft, radii.topRight, radii.bottomRight, radii.bottomLeft].map((r) => r.value)
      : [0, 0, 0, 0]
  }
}

function cornerProps(radii: number[]): Partial<SceneNode> {
  const same = radii.every((radius) => Math.abs(radius - radii[0]) < 1e-6)
  if (same) return { cornerRadius: radii[0] }
  const [topLeftRadius, topRightRadius, bottomRightRadius, bottomLeftRadius] = radii
  return {
    independentCorners: true,
    topLeftRadius,
    topRightRadius,
    bottomRightRadius,
    bottomLeftRadius
  }
}

const BOOLEAN_OPERATIONS: Record<PSDBooleanOperation, BooleanOperation> = {
  combine: 'UNION',
  subtract: 'SUBTRACT',
  intersect: 'INTERSECT',
  exclude: 'EXCLUDE'
}

/** A vector of `paths` placed at their curves' bounds, or null when they draw nothing. */
function addPathVector(
  graph: SceneGraph,
  parentId: string,
  paths: readonly BezierPath[],
  props: Partial<SceneNode>,
  includeOpenRegions: boolean
): SceneNode | null {
  const evenOdd = paths.some((path) => path.fillRule === 'even-odd')
  const network = parseSVGPath(pathData(paths), evenOdd ? 'EVENODD' : 'NONZERO', {
    includeOpenRegions
  })
  if (network.segments.length === 0) return null
  // The layer sits at its curves' bounds, its path moved to start there.
  const box = computeAccurateBounds(network)
  return graph.createNode('VECTOR', parentId, {
    ...props,
    x: round(box.x),
    y: round(box.y),
    width: Math.max(round(box.width), 0.01),
    height: Math.max(round(box.height), 0.01),
    vectorNetwork: transformVectorNetwork([1, 0, -box.x, 0, 1, -box.y, 0, 0, 1], network)
  })
}

/**
 * Paths Photoshop combines by subtracting, intersecting or excluding as a boolean group: each
 * path an operand, applied in order to what the paths before it make, as Photoshop combines them.
 */
function addBooleanPaths(
  graph: SceneGraph,
  parentId: string,
  paths: readonly BezierPath[],
  props: Partial<SceneNode>
): SceneNode | null {
  // Each operand is made when it is combined, so it stacks above what it combines with.
  let result: SceneNode | null = null
  for (const [index, path] of paths.entries()) {
    const vector = addPathVector(graph, parentId, [path], { name: `Path ${index + 1}` }, false)
    if (!vector) continue
    const operation = BOOLEAN_OPERATIONS[path.operation ?? 'combine']
    if (!result) {
      result = vector
    } else if (result.type === 'BOOLEAN_OPERATION' && result.booleanOperation === operation) {
      // Another operand of the same kind joins the group, as (A − B) − C is A − B − C.
      graph.reparentNode(vector.id, result.id)
      fitEnclosingGroups(graph, [result.id])
    } else {
      result = createBooleanOperation(graph, [result, vector], parentId, operation, undefined).node
    }
  }
  if (!result) return null
  graph.updateNode(result.id, props)
  return graph.getNode(result.id) ?? null
}

/** Whether the paths combine other than by adding up, so they make a boolean group. */
function combinesByBoolean(paths: readonly BezierPath[]): boolean {
  return (
    paths.length > 1 && paths.slice(1).some((path) => (path.operation ?? 'combine') !== 'combine')
  )
}

/** The editable layer of a shape or fill layer, or null when it has nothing to draw. */
export function addShapeLayer(
  graph: SceneGraph,
  parentId: string,
  layer: Layer,
  base: Partial<SceneNode>,
  canvas: { width: number; height: number },
  patternFill?: PatternFill
): SceneNode | null {
  const props = { ...base, fills: layerFills(layer, patternFill), strokes: layerStrokes(layer) }
  const paths = layer.vectorMask?.paths ?? []
  // Only one shape in the layer can be a live shape; more paths are drawn as a vector.
  const live = paths.length === 1 ? liveShape(layer.vectorOrigination?.keyDescriptorList[0]) : null
  if (live) {
    const placed = { ...props, x: live.x, y: live.y, width: live.width, height: live.height }
    if (live.type === ORIGIN_ELLIPSE) return graph.createNode('ELLIPSE', parentId, placed)
    return graph.createNode('RECTANGLE', parentId, { ...placed, ...cornerProps(live.radii) })
  }
  if (paths.length === 0) {
    // A fill layer with no path fills the whole canvas.
    return graph.createNode('RECTANGLE', parentId, { ...props, x: 0, y: 0, ...canvas })
  }
  if (combinesByBoolean(paths)) {
    const shape = addBooleanPaths(graph, parentId, paths, props)
    if (shape) return shape
  }
  return addPathVector(
    graph,
    parentId,
    paths,
    props,
    props.fills.length > 0 && props.strokes.length === 0
  )
}
