import type { Path } from 'canvaskit-wasm'
import { uniq } from 'es-toolkit'

import type { SceneGraph, SceneNode } from '@lawha/scene-graph'
import { getNodeLocalMatrix } from '@lawha/scene-graph/coordinate'
import { copyEffects, copyFills, copyStrokes } from '@lawha/scene-graph/copy'
import type { Vector } from '@lawha/scene-graph/primitives'

import { canMakeBooleanSourceNode, flattenSourcePath, placedPath, windingRuleOf } from './boolean'
import { networkIn } from './flatten'
import { connectedPieces } from './paths/contours'
import type { SkiaRenderer } from './renderer'

/** Layers Shape Builder cuts: closed shapes, vectors, text, and boolean results. */
const SHAPE_BUILDER_TYPES = new Set<SceneNode['type']>([
  'RECTANGLE',
  'ROUNDED_RECTANGLE',
  'ELLIPSE',
  'POLYGON',
  'STAR',
  'VECTOR',
  'TEXT',
  'BOOLEAN_OPERATION'
])

/** Most layers Shape Builder divides at once; regions grow with every overlap. */
export const SHAPE_BUILDER_MAX_LAYERS = 24

export type ShapeBuilderMode = 'merge' | 'delete'

/** One region of overlapping layers: a connected area covered by the same layers. */
export interface ShapeBuilderRegion {
  /** The area in the layers' parent's coordinates. */
  path: Path
  /** Indices of the layers covering it, bottom first. */
  owners: number[]
}

/** What Shape Builder does to the layers: each touched layer's remaining area, and the merge. */
export interface ShapeBuilderPlan {
  /** Every layer the picked regions touched, with what is left of it, or null when nothing is. */
  remains: { node: SceneNode; path: Path | null }[]
  /** The merged area and the layer whose look it takes, when merging. */
  merged: { path: Path; style: SceneNode } | null
}

export function canShapeBuild(node: SceneNode, graph: SceneGraph): boolean {
  return SHAPE_BUILDER_TYPES.has(node.type) && canMakeBooleanSourceNode(node, graph)
}

/** A layer's filled area in its parent's coordinates. */
export function shapeBuilderSourcePath(
  r: SkiaRenderer,
  node: SceneNode,
  graph: SceneGraph
): Path | null {
  const own = flattenSourcePath(r, node, graph)
  if (!own) return null
  const placed = placedPath(r, own, getNodeLocalMatrix(node))
  own.delete()
  return placed
}

function combine(r: SkiaRenderer, a: Path, b: Path, op: 'Union' | 'Difference' | 'Intersect') {
  return r.ck.Path.MakeFromOp(a, b, r.ck.PathOp[op])
}

function keep(path: Path | null): Path | null {
  if (path && !path.isEmpty()) return path
  path?.delete()
  return null
}

/**
 * Divides overlapping shapes into the regions Illustrator's Shape Builder shows: every connected
 * area covered by the same set of shapes is one region. `paths` are in one coordinate space and
 * are not taken over.
 */
export function divideIntoRegions(r: SkiaRenderer, paths: readonly Path[]): ShapeBuilderRegion[] {
  let parts: { path: Path; owners: number[] }[] = []
  let covered: Path | null = null
  for (const [index, shape] of paths.entries()) {
    const next: { path: Path; owners: number[] }[] = []
    for (const part of parts) {
      const inside = keep(combine(r, part.path, shape, 'Intersect'))
      const outside = keep(combine(r, part.path, shape, 'Difference'))
      if (inside) next.push({ path: inside, owners: [...part.owners, index] })
      if (outside) next.push({ path: outside, owners: part.owners })
      part.path.delete()
    }
    const alone = keep(covered ? combine(r, shape, covered, 'Difference') : shape.copy())
    if (alone) next.push({ path: alone, owners: [index] })
    const grown: Path | null = covered ? combine(r, covered, shape, 'Union') : shape.copy()
    covered?.delete()
    covered = grown
    parts = next
  }
  covered?.delete()
  const regions: ShapeBuilderRegion[] = []
  for (const part of parts) {
    for (const piece of connectedPieces(r.ck, part.path)) {
      regions.push({ path: piece, owners: part.owners })
    }
    part.path.delete()
  }
  return regions
}

/** The regions of `nodes`, siblings in one parent, in that parent's coordinates. */
export function shapeBuilderRegions(
  r: SkiaRenderer,
  graph: SceneGraph,
  nodes: readonly SceneNode[]
): ShapeBuilderRegion[] {
  const paths = nodes.flatMap((node) => shapeBuilderSourcePath(r, node, graph) ?? [])
  if (paths.length !== nodes.length) {
    for (const path of paths) path.delete()
    return []
  }
  try {
    return divideIntoRegions(r, paths)
  } finally {
    for (const path of paths) path.delete()
  }
}

/** The regions under `points`, in the order the points first reach them. */
export function regionsAt(regions: readonly ShapeBuilderRegion[], points: readonly Vector[]) {
  const picked: ShapeBuilderRegion[] = []
  for (const point of points) {
    const region = regions.findLast((candidate) => candidate.path.contains(point.x, point.y))
    if (region && !picked.includes(region)) picked.push(region)
  }
  return picked
}

/**
 * What merging or deleting the regions under `points` makes of `nodes` (siblings, bottom
 * first): every layer they touch loses them, and a merge adds them back as one shape painted like
 * the topmost layer of the first region picked, as Illustrator takes the colour it starts on.
 */
export function planShapeBuilder(
  r: SkiaRenderer,
  graph: SceneGraph,
  nodes: readonly SceneNode[],
  points: readonly Vector[],
  mode: ShapeBuilderMode
): ShapeBuilderPlan | null {
  const sources = nodes.map((node) => shapeBuilderSourcePath(r, node, graph))
  const complete = sources.filter((path): path is Path => path !== null)
  const regions = complete.length === sources.length ? divideIntoRegions(r, complete) : []
  try {
    const picked = regionsAt(regions, points)
    const first = picked.at(0)
    if (!first) return null
    let area = first.path.copy()
    for (const region of picked.slice(1)) {
      const united = combine(r, area, region.path, 'Union')
      area.delete()
      if (!united) return null
      area = united
    }
    const touched = uniq(picked.flatMap((region) => region.owners)).sort((a, b) => a - b)
    const remains = touched.map((index) => {
      const source = sources[index]
      return {
        node: nodes[index],
        path: source ? keep(combine(r, source, area, 'Difference')) : null
      }
    })
    const style = nodes[first.owners.at(-1) ?? 0]
    if (mode === 'delete') {
      area.delete()
      return { remains, merged: null }
    }
    return { remains, merged: { path: area, style } }
  } finally {
    for (const region of regions) region.path.delete()
    for (const path of sources) path?.delete()
  }
}

/** Frees the paths a plan holds. */
export function disposeShapeBuilderPlan(plan: ShapeBuilderPlan): void {
  for (const { path } of plan.remains) path?.delete()
  plan.merged?.path.delete()
}

/**
 * The props of a vector drawing `path` (in the parent's coordinates) with `style`'s paint,
 * stroke, effects, and opacity, as a cut layer keeps its look.
 */
export function vectorPropsForPath(
  r: SkiaRenderer,
  path: Path,
  style: SceneNode,
  name = style.name
): Partial<SceneNode> {
  const [left, top, right, bottom] = path.computeTightBounds()
  const box = { x: left, y: top, width: right - left, height: bottom - top }
  const network = networkIn(r, path, box)
  for (const region of network.regions) region.windingRule = windingRuleOf(r, path)
  return {
    name,
    ...box,
    vectorNetwork: network,
    fills: copyFills(style.fills),
    strokes: copyStrokes(style.strokes),
    strokeWeight: style.strokeWeight,
    strokeAlign: style.strokeAlign,
    strokeCap: style.strokeCap,
    strokeJoin: style.strokeJoin,
    strokeMiterLimit: style.strokeMiterLimit,
    dashPattern: [...style.dashPattern],
    effects: copyEffects(style.effects),
    opacity: style.opacity,
    blendMode: style.blendMode,
    visible: style.visible
  }
}
