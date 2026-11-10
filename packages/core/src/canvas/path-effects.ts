import type { Path } from 'canvaskit-wasm'
import { omit } from 'es-toolkit'

import type { SceneGraph, SceneNode } from '@lawha/scene-graph'
import type { Color, Vector } from '@lawha/scene-graph/primitives'

import { widthAt, type WidthPoint } from '#core/vector/width'

import { canMakeBooleanSourceNode } from './boolean'
import type { SkiaRenderer } from './renderer'
import { shapeBuilderSourcePath, vectorPropsForPath } from './shape-builder'

export type OffsetJoin = 'MITER' | 'ROUND' | 'BEVEL'

const STROKE_JOINS = { MITER: 'Miter', ROUND: 'Round', BEVEL: 'Bevel' } as const

/** Layers offset, blended, or given a width profile: anything with an outline, not containers. */
const PATH_EFFECT_TYPES = new Set<SceneNode['type']>([
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

export function canTakePathEffect(node: SceneNode, graph: SceneGraph): boolean {
  return PATH_EFFECT_TYPES.has(node.type) && canMakeBooleanSourceNode(node, graph)
}

/**
 * Illustrator's Offset Path: the layer's filled area grown by `distance` (shrunk when negative)
 * with corners joined as `join` asks, as a new vector painted like the layer, in its parent's
 * coordinates. Null when nothing is left, as when a shape shrinks past its middle.
 */
export function offsetPathProps(
  r: SkiaRenderer,
  graph: SceneGraph,
  node: SceneNode,
  distance: number,
  join: OffsetJoin = 'MITER',
  miterLimit = 4
): Partial<SceneNode> | null {
  if (!canTakePathEffect(node, graph) || !Number.isFinite(distance)) return null
  const source = shapeBuilderSourcePath(r, node, graph)
  if (!source) return null
  try {
    if (distance === 0) return vectorPropsForPath(r, source, node, `${node.name} (Offset)`)
    const band = source.makeStroked({
      width: Math.abs(distance) * 2,
      join: r.ck.StrokeJoin[STROKE_JOINS[join]],
      miter_limit: miterLimit
    })
    if (!band) return null
    const op = distance > 0 ? r.ck.PathOp.Union : r.ck.PathOp.Difference
    const result = r.ck.Path.MakeFromOp(source, band, op)
    band.delete()
    if (!result) return null
    try {
      if (result.isEmpty()) return null
      return vectorPropsForPath(r, result, node, `${node.name} (Offset)`)
    } finally {
      result.delete()
    }
  } finally {
    source.delete()
  }
}

/** Points along every contour of `path` at about `spacing` apart, with each one's unit normal. */
function sampleContours(r: SkiaRenderer, path: Path, spacing: number) {
  const contours: { points: Vector[]; normals: Vector[]; closed: boolean }[] = []
  const iter = new r.ck.ContourMeasureIter(path, false, 1)
  for (let contour = iter.next(); contour; contour = iter.next()) {
    const length = contour.length()
    const closed = contour.isClosed()
    if (length > 0) {
      const steps = Math.max(8, Math.min(2000, Math.ceil(length / spacing)))
      const points: Vector[] = []
      const normals: Vector[] = []
      const count = closed ? steps : steps + 1
      for (let i = 0; i < count; i++) {
        const [x, y, tx, ty] = contour.getPosTan((i / steps) * length)
        const norm = Math.hypot(tx, ty) || 1
        points.push({ x, y })
        normals.push({ x: -ty / norm, y: tx / norm })
      }
      contours.push({ points, normals, closed })
    }
    contour.delete()
  }
  iter.delete()
  return contours
}

/**
 * Illustrator's Width tool, expanded: the layer's stroke drawn with a width that varies along
 * the path by `points`, as a filled vector painted with the stroke. Each contour runs its own
 * 0…1. Null when the layer has no visible stroke.
 */
export function widthProfileProps(
  r: SkiaRenderer,
  graph: SceneGraph,
  node: SceneNode,
  points: readonly WidthPoint[]
): Partial<SceneNode> | null {
  if (!canTakePathEffect(node, graph)) return null
  const stroke = node.strokes.find((paint) => paint.visible && paint.opacity > 0)
  const weight = stroke?.weight ?? node.strokeWeight
  if (!stroke || weight <= 0) return null
  const centre = shapeBuilderSourcePath(r, node, graph)
  if (!centre) return null
  let area: Path | null = null
  try {
    for (const contour of sampleContours(r, centre, Math.max(0.5, weight / 4))) {
      const n = contour.points.length
      const side = (sign: 1 | -1, i: number) => {
        const t = contour.closed ? i / n : i / Math.max(1, n - 1)
        const half = (weight * widthAt(points, t)) / 2
        const p = contour.points[i]
        const normal = contour.normals[i]
        return { x: p.x + sign * normal.x * half, y: p.y + sign * normal.y * half }
      }
      const left = contour.points.map((_, i) => side(1, i))
      const right = contour.points.map((_, i) => side(-1, i))
      const builder = new r.ck.PathBuilder()
      if (contour.closed) {
        // A closed path's band is the ring between its two sides.
        addPolygon(builder, left)
        addPolygon(builder, right.toReversed())
      } else {
        addPolygon(builder, [...left, ...right.toReversed()])
      }
      const band = builder.detachAndDelete()
      // A ring is the area between its sides; an open band that folds over itself stays filled.
      band.setFillType(contour.closed ? r.ck.FillType.EvenOdd : r.ck.FillType.Winding)
      const united: Path | null = area ? r.ck.Path.MakeFromOp(area, band, r.ck.PathOp.Union) : band
      if (area) {
        area.delete()
        band.delete()
      }
      area = united
    }
    if (!area || area.isEmpty()) return null
    return {
      ...vectorPropsForPath(r, area, node, `${node.name} (Width)`),
      fills: [omit(stroke, ['weight', 'align', 'cap', 'join', 'dashPattern'])],
      strokes: []
    }
  } finally {
    area?.delete()
    centre.delete()
  }
}

function addPolygon(
  builder: InstanceType<SkiaRenderer['ck']['PathBuilder']>,
  points: readonly Vector[]
) {
  if (points.length === 0) return
  const [first, ...rest] = points
  builder.moveTo(first.x, first.y)
  for (const point of rest) builder.lineTo(point.x, point.y)
  builder.close()
}

/** Points round the largest contour of `path`, `count` of them, evenly spaced, clockwise. */
function outlinePoints(r: SkiaRenderer, path: Path, count: number): Vector[] | null {
  const iter = new r.ck.ContourMeasureIter(path, true, 1)
  let best: Vector[] | null = null
  let bestLength = 0
  for (let contour = iter.next(); contour; contour = iter.next()) {
    const length = contour.length()
    if (length > bestLength) {
      bestLength = length
      best = []
      for (let i = 0; i < count; i++) {
        const [x, y] = contour.getPosTan((i / count) * length)
        best.push({ x, y })
      }
    }
    contour.delete()
  }
  iter.delete()
  if (!best) return null
  let twice = 0
  for (let i = 0; i < best.length; i++) {
    const a = best[i]
    const b = best[(i + 1) % best.length]
    twice += a.x * b.y - b.x * a.y
  }
  return twice < 0 ? best.toReversed() : best
}

/** `to` turned so its first point is the one nearest `from`'s first, so steps do not twist. */
function aligned(from: readonly Vector[], to: readonly Vector[]): Vector[] {
  let best = 0
  let bestCost = Infinity
  for (let shift = 0; shift < to.length; shift++) {
    let cost = 0
    for (let i = 0; i < from.length; i += Math.max(1, Math.floor(from.length / 16))) {
      const p = from[i]
      const q = to[(i + shift) % to.length]
      cost += (p.x - q.x) ** 2 + (p.y - q.y) ** 2
    }
    if (cost < bestCost) {
      bestCost = cost
      best = shift
    }
  }
  return to.map((_, i) => to[(i + best) % to.length])
}

function mixColor(a: Color, b: Color, t: number): Color {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
    a: a.a + (b.a - a.a) * t
  }
}

const BLEND_SAMPLES = 256

/**
 * Illustrator's Blend: `steps` shapes between `from` and `to` (siblings), their outlines, solid
 * colours, opacity, and stroke weight eased from one to the other, as props of vectors in the
 * parent's coordinates, from the `from` side. Outlines blend through their largest contours.
 */
export function blendStepProps(
  r: SkiaRenderer,
  graph: SceneGraph,
  from: SceneNode,
  to: SceneNode,
  steps: number
): Partial<SceneNode>[] | null {
  if (!canTakePathEffect(from, graph) || !canTakePathEffect(to, graph) || steps < 1) return null
  const fromPath = shapeBuilderSourcePath(r, from, graph)
  const toPath = shapeBuilderSourcePath(r, to, graph)
  try {
    if (!fromPath || !toPath) return null
    const a = outlinePoints(r, fromPath, BLEND_SAMPLES)
    const bRaw = outlinePoints(r, toPath, BLEND_SAMPLES)
    if (!a || !bRaw) return null
    const b = aligned(a, bRaw)
    const fromFill = from.fills.find((fill) => fill.visible && fill.type === 'SOLID')
    const toFill = to.fills.find((fill) => fill.visible && fill.type === 'SOLID')
    const results: Partial<SceneNode>[] = []
    for (let step = 1; step <= steps; step++) {
      const t = step / (steps + 1)
      const builder = new r.ck.PathBuilder()
      addPolygon(
        builder,
        a.map((p, i) => ({ x: p.x + (b[i].x - p.x) * t, y: p.y + (b[i].y - p.y) * t }))
      )
      const path = builder.detachAndDelete()
      const style = t < 0.5 ? from : to
      const props = vectorPropsForPath(r, path, style, `Blend ${step}`)
      path.delete()
      if (fromFill && toFill)
        props.fills = [
          {
            ...fromFill,
            color: mixColor(fromFill.color, toFill.color, t),
            opacity: fromFill.opacity + (toFill.opacity - fromFill.opacity) * t
          }
        ]
      props.opacity = from.opacity + (to.opacity - from.opacity) * t
      props.strokeWeight = from.strokeWeight + (to.strokeWeight - from.strokeWeight) * t
      props.strokes = (props.strokes ?? []).map((stroke) => ({
        ...stroke,
        weight: props.strokeWeight ?? stroke.weight
      }))
      results.push(props)
    }
    return results
  } finally {
    fromPath?.delete()
    toPath?.delete()
  }
}
