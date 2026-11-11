import type { SceneGraph, SceneNode } from '@lawha/scene-graph'
import { getParentWorldMatrix } from '@lawha/scene-graph/coordinate'
import Matrix from '@lawha/scene-graph/matrix'
import type { MeshHandleSide, MeshPoint } from '@lawha/scene-graph/path-effects'
import type { Rect, Vector } from '@lawha/scene-graph/primitives'

import { meshInBox } from '#core/vector/warp'
import { widthAt } from '#core/vector/width'

import { effectSourceInParent, pathEffectOf } from './live-effects'
import type { SkiaRenderer } from './renderer'

/** A mesh point's handle on canvas: where it ends and the point it belongs to. */
export interface MeshHandleMark {
  row: number
  column: number
  side: MeshHandleSide
  x: number
  y: number
  fromX: number
  fromY: number
}

/** The grid of a live envelope mesh, in canvas coordinates, for its on-canvas editing. */
export interface MeshHandles {
  kind: 'mesh'
  nodeId: string
  rows: number
  columns: number
  points: { row: number; column: number; x: number; y: number }[]
  handles: MeshHandleMark[]
  /** The mesh's edges as SVG path data. */
  grid: string
}

/** A width point on canvas: its place on the centre line and the ends of its width. */
export interface WidthPointMark {
  index: number
  t: number
  x: number
  y: number
  left: Vector
  right: Vector
}

/** The centre line and width points of a live width profile, in canvas coordinates. */
export interface WidthHandles {
  kind: 'width'
  nodeId: string
  /** The stroke's centre line as SVG path data. */
  centre: string
  points: WidthPointMark[]
}

export type LiveEffectHandles = MeshHandles | WidthHandles

/** What a press on a live effect's handles takes hold of. */
export type LiveEffectHandleHit =
  | { kind: 'mesh-point'; row: number; column: number }
  | { kind: 'mesh-handle'; row: number; column: number; side: MeshHandleSide }
  | { kind: 'width-point'; index: number; along: boolean }
  | { kind: 'width-path'; t: number }

/** What decides whose live effect handles a canvas pane shows. */
export interface LiveEffectHandleState {
  activeTool: string
  selectedIds: ReadonlySet<string>
  hoveredNodeId: string | null
  editingTextId: string | null
  nodeEditState?: unknown
}

/** Which live effect's handles each tool shows: a width profile's or an envelope mesh's. */
const HANDLE_KINDS = new Map<string, 'width' | 'mesh'>([
  ['WIDTH', 'width'],
  ['SELECT', 'mesh']
])

/** The layer a canvas pane shows a live effect's handles for, and which kind it shows. */
function handleTarget(graph: SceneGraph, state: LiveEffectHandleState): SceneNode | null {
  if (state.editingTextId || state.nodeEditState) return null
  const selected = state.selectedIds.size === 1 ? [...state.selectedIds][0] : null
  const kind = HANDLE_KINDS.get(state.activeTool)
  if (!kind) return null
  const ids = kind === 'width' ? [selected, state.hoveredNodeId] : [selected]
  for (const id of ids) {
    const node = id ? graph.getNode(id) : undefined
    if (node && pathEffectOf(node)?.kind === kind) return node
  }
  return null
}

/**
 * The handles a canvas pane draws for a live effect: an envelope mesh's points and handles while
 * its layer is the selection, and a width profile's points under the Width tool.
 */
export function liveEffectHandlesForState(
  r: SkiaRenderer,
  graph: SceneGraph,
  state: LiveEffectHandleState
): LiveEffectHandles | null {
  const node = handleTarget(graph, state)
  if (!node) return null
  return state.activeTool === 'WIDTH'
    ? widthHandlesFor(r, graph, node)
    : meshHandlesFor(r, graph, node)
}

const SIDES: readonly MeshHandleSide[] = ['left', 'right', 'up', 'down']

/** The neighbour a mesh handle points towards, by side. */
const SIDE_STEP: Record<MeshHandleSide, [number, number]> = {
  left: [0, -1],
  right: [0, 1],
  up: [-1, 0],
  down: [1, 0]
}

function worldOf(graph: SceneGraph, node: SceneNode) {
  const parent = node.parentId ? graph.getNode(node.parentId) : undefined
  return getParentWorldMatrix(parent, graph)
}

/** A canvas point in a layer's parent, where its live effect's outline and box are. */
export function canvasToParent(graph: SceneGraph, node: SceneNode, point: Vector): Vector | null {
  const inverse = Matrix.invert(worldOf(graph, node))
  return inverse ? Matrix.mapPoint(inverse, point) : null
}

function boundsOf(path: { computeTightBounds(): Float32Array }): Rect {
  const [left, top, right, bottom] = path.computeTightBounds()
  return { x: left, y: top, width: right - left, height: bottom - top }
}

/** A mesh point's handle end in the parent: its own, or a third of the way to its neighbour. */
function handleEndIn(
  points: ReturnType<typeof meshInBox>['points'],
  columns: number,
  rows: number,
  row: number,
  column: number,
  side: MeshHandleSide
): Vector | null {
  const [dr, dc] = SIDE_STEP[side]
  const nr = row + dr
  const nc = column + dc
  if (nr < 0 || nc < 0 || nr > rows || nc > columns) return null
  const point = points[row * (columns + 1) + column]
  const offset = point[side]
  if (offset) return { x: point.x + offset.x, y: point.y + offset.y }
  const next = points[nr * (columns + 1) + nc]
  return { x: point.x + (next.x - point.x) / 3, y: point.y + (next.y - point.y) / 3 }
}

/** A live mesh's points, handles, and edges on canvas; null for a layer without one. */
export function meshHandlesFor(
  r: SkiaRenderer,
  graph: SceneGraph,
  node: SceneNode
): MeshHandles | null {
  const effect = pathEffectOf(node)
  if (effect?.kind !== 'mesh') return null
  const source = effectSourceInParent(r, node, effect)
  if (!source) return null
  const box = boundsOf(source)
  source.delete()
  const { rows, columns } = effect
  const mesh = meshInBox(box, rows, columns, effect.points)
  const world = worldOf(graph, node)
  const toCanvas = (p: Vector) => Matrix.mapPoint(world, p)
  const points: MeshHandles['points'] = []
  const handles: MeshHandleMark[] = []
  const builder = new r.ck.PathBuilder()
  for (let row = 0; row <= rows; row++) {
    for (let column = 0; column <= columns; column++) {
      const point = mesh.points[row * (columns + 1) + column]
      const at = toCanvas(point)
      points.push({ row, column, x: at.x, y: at.y })
      for (const side of SIDES) {
        const end = handleEndIn(mesh.points, columns, rows, row, column, side)
        if (!end) continue
        const mark = toCanvas(end)
        handles.push({ row, column, side, x: mark.x, y: mark.y, fromX: at.x, fromY: at.y })
      }
      // Each point draws its edges to the right and down, through both ends' handles.
      for (const side of ['right', 'down'] as const) {
        const [dr, dc] = SIDE_STEP[side]
        if (row + dr > rows || column + dc > columns) continue
        const next = mesh.points[(row + dr) * (columns + 1) + column + dc]
        const back = side === 'right' ? 'left' : 'up'
        const c1 = handleEndIn(mesh.points, columns, rows, row, column, side)
        const c2 = handleEndIn(mesh.points, columns, rows, row + dr, column + dc, back)
        if (!c1 || !c2) continue
        const [a, b, c, d] = [point, c1, c2, next].map(toCanvas)
        builder.moveTo(a.x, a.y)
        builder.cubicTo(b.x, b.y, c.x, c.y, d.x, d.y)
      }
    }
  }
  const grid = builder.detachAndDelete()
  const data = grid.toSVGString()
  grid.delete()
  return { kind: 'mesh', nodeId: node.id, rows, columns, points, handles, grid: data }
}

/** The first contour of a live width profile's centre line in the parent, measured. */
function measureCentre(r: SkiaRenderer, node: SceneNode) {
  const effect = pathEffectOf(node)
  if (effect?.kind !== 'width') return null
  const source = effectSourceInParent(r, node, effect)
  if (!source) return null
  const iter = new r.ck.ContourMeasureIter(source, false, 1)
  const contour = iter.next()
  iter.delete()
  if (!contour) {
    source.delete()
    return null
  }
  return { effect, source, contour, length: contour.length() }
}

/** The place, unit normal, and share of the length of the centre line at `t`. */
function centreAt(
  contour: { getPosTan(distance: number): Float32Array },
  length: number,
  t: number
) {
  const [x, y, tx, ty] = contour.getPosTan(Math.max(0, Math.min(1, t)) * length)
  const norm = Math.hypot(tx, ty) || 1
  return { point: { x, y }, normal: { x: -ty / norm, y: tx / norm } }
}

/** A live width profile's centre line and width points on canvas; null for a layer without one. */
export function widthHandlesFor(
  r: SkiaRenderer,
  graph: SceneGraph,
  node: SceneNode
): WidthHandles | null {
  const measured = measureCentre(r, node)
  if (!measured) return null
  const { effect, source, contour, length } = measured
  try {
    const world = worldOf(graph, node)
    const toCanvas = (p: Vector) => Matrix.mapPoint(world, p)
    const points = effect.points.map((point, index): WidthPointMark => {
      const { point: at, normal } = centreAt(contour, length, point.t)
      const half = (effect.weight * widthAt(effect.points, point.t)) / 2
      const centre = toCanvas(at)
      return {
        index,
        t: point.t,
        x: centre.x,
        y: centre.y,
        left: toCanvas({ x: at.x + normal.x * half, y: at.y + normal.y * half }),
        right: toCanvas({ x: at.x - normal.x * half, y: at.y - normal.y * half })
      }
    })
    const builder = new r.ck.PathBuilder()
    builder.addPath(source, world)
    const placed = builder.detachAndDelete()
    const centre = placed.toSVGString()
    placed.delete()
    return { kind: 'width', nodeId: node.id, centre, points }
  } finally {
    contour.delete()
    source.delete()
  }
}

function near(a: Vector, b: Vector, radius: number) {
  return Math.hypot(a.x - b.x, a.y - b.y) <= radius
}

/**
 * The share of a live width profile's centre line nearest a point in the parent, and how far
 * the point is from it there, in the parent's units; null for a layer without one.
 */
export function nearestOnCentre(r: SkiaRenderer, node: SceneNode, point: Vector) {
  const measured = measureCentre(r, node)
  if (!measured) return null
  const { contour, length, source, effect } = measured
  try {
    const samples = Math.max(16, Math.min(2000, Math.ceil(length / 2)))
    let best = { t: 0, distance: Infinity, side: 1 }
    for (let i = 0; i <= samples; i++) {
      const t = i / samples
      const at = centreAt(contour, length, t)
      const dx = point.x - at.point.x
      const dy = point.y - at.point.y
      const distance = Math.hypot(dx, dy)
      if (distance < best.distance) {
        const side = dx * at.normal.x + dy * at.normal.y >= 0 ? 1 : -1
        best = { t, distance, side }
      }
    }
    return { ...best, weight: effect.weight }
  } finally {
    contour.delete()
    source.delete()
  }
}

/**
 * The handle of a live effect under a canvas point, within `radius` canvas units: mesh points
 * before their handles, a width point's ends (which set its width) before its middle (which
 * moves it along the line), and otherwise the centre line, where a new width point would go.
 */
export function liveEffectHandleAt(
  r: SkiaRenderer,
  graph: SceneGraph,
  handles: LiveEffectHandles,
  point: Vector,
  radius: number
): LiveEffectHandleHit | null {
  if (handles.kind === 'mesh') {
    const onPoint = handles.points.find((mark) => near(mark, point, radius))
    if (onPoint) return { kind: 'mesh-point', row: onPoint.row, column: onPoint.column }
    const onHandle = handles.handles.find((mark) => near(mark, point, radius))
    if (onHandle)
      return {
        kind: 'mesh-handle',
        row: onHandle.row,
        column: onHandle.column,
        side: onHandle.side
      }
    return null
  }
  const onEnd = handles.points.find(
    (mark) => near(mark.left, point, radius) || near(mark.right, point, radius)
  )
  if (onEnd) return { kind: 'width-point', index: onEnd.index, along: false }
  const onMiddle = handles.points.find((mark) => near(mark, point, radius))
  if (onMiddle) return { kind: 'width-point', index: onMiddle.index, along: true }
  const node = graph.getNode(handles.nodeId)
  const local = node && canvasToParent(graph, node, point)
  const nearest = node && local ? nearestOnCentre(r, node, local) : null
  if (!node || !nearest) return null
  // The line takes a press anywhere inside the stroke it draws.
  const pathEffect = pathEffectOf(node)
  const reach =
    pathEffect?.kind === 'width'
      ? Math.max(radius, (pathEffect.weight * widthAt(pathEffect.points, nearest.t)) / 2)
      : radius
  return nearest.distance <= reach ? { kind: 'width-path', t: nearest.t } : null
}

/** A mesh point stored against its box (0…1) from a point in the parent. */
export function meshPointIn(box: Rect, point: Vector): Pick<MeshPoint, 'x' | 'y'> {
  return {
    x: (point.x - box.x) / Math.max(box.width, 1e-9),
    y: (point.y - box.y) / Math.max(box.height, 1e-9)
  }
}
