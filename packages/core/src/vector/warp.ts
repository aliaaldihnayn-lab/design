import type { MeshHandleSide, MeshPoint, WarpPreset } from '@lawha/scene-graph/path-effects'
import type { Rect, Vector } from '@lawha/scene-graph/primitives'

import { controlPolygonLength, splitCubicAt } from '#core/vector/curve-math'

/** How a warp bends: `bend` and both distortions run from −1 to 1, as Illustrator's percentages. */
export interface WarpOptions {
  preset: WarpPreset
  bend: number
  /** Narrows one side and widens the other along the width, as a horizontal perspective. */
  horizontal?: number
  /** Narrows the top or the bottom, as a vertical perspective. */
  vertical?: number
  /** Bends across the height instead of the width. */
  vertically?: boolean
}

/** A closed or open run of cubic curves: each segment is its two control points and its end. */
export interface CubicContour {
  start: Vector
  segments: [Vector, Vector, Vector][]
  closed: boolean
}

/**
 * An envelope mesh: `rows + 1` by `columns + 1` points, row by row, where each grid point went,
 * with its curve handles as offsets from it. A handle left out runs straight to the next point.
 */
export interface EnvelopeMesh {
  rows: number
  columns: number
  /** Every grid point's position in the box, row by row from the top left. */
  points: (Vector & Partial<Record<MeshHandleSide, Vector>>)[]
}

/** A map of the unit square centred on the origin (−1…1 both ways) onto the warped shape. */
type UnitWarp = (u: number, v: number) => Vector

const HALF_PI = Math.PI / 2

function presetWarp(preset: WarpPreset, bend: number): UnitWarp {
  switch (preset) {
    case 'arc': {
      // The box bends round a centre below (or above) it, its middle line keeping its length.
      const angle = bend * HALF_PI
      if (Math.abs(angle) < 1e-6) return (u, v) => ({ x: u, y: v })
      const radius = 1 / angle
      return (u, v) => {
        const phi = u * angle
        const r = radius - v
        return { x: r * Math.sin(phi), y: radius - r * Math.cos(phi) }
      }
    }
    case 'arch':
      return (u, v) => ({ x: u, y: v - bend * (1 - u * u) })
    case 'bulge':
      return (u, v) => ({ x: u, y: v * (1 + bend * (1 - u * u)) })
    case 'flag':
      return (u, v) => ({ x: u, y: v - 0.5 * bend * Math.sin(Math.PI * u) })
    case 'wave':
      // The waves run against each other at the top and the bottom, as Illustrator's do.
      return (u, v) => ({ x: u, y: v - 0.5 * bend * Math.sin(Math.PI * u) * v })
    case 'fish': {
      // A body that swells towards the head and a tail that flares at the far end.
      return (u, v) => {
        const body = 1 - ((u + 0.35) / 1.35) ** 2
        const tail = Math.max(0, u - 0.6) / 0.4
        return { x: u, y: v * (1 + bend * (0.6 * body - 0.4 * tail * (1 - tail) * 4 + 0.3 * tail)) }
      }
    }
    case 'rise':
      return (u, v) => ({ x: u, y: v - bend * 0.5 * (u + 1) * (u + 1) * 0.5 + bend * 0.5 })
    case 'squeeze':
      return (u, v) => ({ x: u * (1 + 0.5 * bend * v * v), y: v * (1 - 0.5 * bend * (1 - u * u)) })
    case 'twist': {
      // Turns most at the centre, not at all at the corners.
      return (u, v) => {
        const fall = Math.max(0, 1 - Math.hypot(u, v) / Math.SQRT2)
        const angle = bend * Math.PI * fall * fall
        const c = Math.cos(angle)
        const s = Math.sin(angle)
        return { x: u * c - v * s, y: u * s + v * c }
      }
    }
    default: {
      const exhaustive: never = preset
      return exhaustive
    }
  }
}

/** Clamps to −1…1, treating anything that is not a finite number as 0. */
function amount(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0
  return Math.max(-1, Math.min(1, value))
}

/** The warp a preset makes of points in `box`. */
export function warpFunction(box: Rect, options: WarpOptions): (point: Vector) => Vector {
  const bend = amount(options.bend)
  const horizontal = amount(options.horizontal)
  const vertical = amount(options.vertical)
  const unit = presetWarp(options.preset, bend)
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  const hw = Math.max(box.width / 2, 1e-9)
  const hh = Math.max(box.height / 2, 1e-9)
  return (point) => {
    let u = (point.x - cx) / hw
    let v = (point.y - cy) / hh
    if (options.vertically) [u, v] = [v, u]
    let warped = unit(u, v)
    if (options.vertically) warped = { x: warped.y, y: warped.x }
    // Perspective: one side grows as the other shrinks.
    const x = warped.x * (1 + 0.5 * vertical * warped.y)
    const y = warped.y * (1 + 0.5 * horizontal * warped.x)
    return { x: cx + x * hw, y: cy + y * hh }
  }
}

/** A flat grid for `box` with `rows` by `columns` cells, the mesh that changes nothing. */
export function flatMesh(box: Rect, rows: number, columns: number): EnvelopeMesh {
  const points: Vector[] = []
  for (let row = 0; row <= rows; row++) {
    for (let column = 0; column <= columns; column++) {
      points.push({
        x: box.x + (column / columns) * box.width,
        y: box.y + (row / rows) * box.height
      })
    }
  }
  return { rows, columns, points }
}

type MeshGridPoint = EnvelopeMesh['points'][number]

/** A cubic's point at `s` from its four control points. */
function cubicAt(p0: Vector, p1: Vector, p2: Vector, p3: Vector, s: number): Vector {
  const u = 1 - s
  const a = u * u * u
  const b = 3 * u * u * s
  const c = 3 * u * s * s
  const d = s * s * s
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y
  }
}

/** Where a point's handle on `side` reaches: its own, or a third of the way to `neighbour`. */
function handleEnd(point: MeshGridPoint, side: MeshHandleSide, neighbour: Vector): Vector {
  const offset = point[side]
  if (offset) return { x: point.x + offset.x, y: point.y + offset.y }
  return { x: point.x + (neighbour.x - point.x) / 3, y: point.y + (neighbour.y - point.y) / 3 }
}

/**
 * The envelope a mesh makes of points in `box`: a point keeps its place in its grid cell, and
 * the cell is the Coons patch between its four edges, each a cubic curve from one mesh point to
 * the next through their handles, as Illustrator's mesh envelope bends between its points. With
 * no handles moved every edge is straight and the patch blends its corners bilinearly.
 */
export function meshFunction(box: Rect, mesh: EnvelopeMesh): (point: Vector) => Vector {
  const { rows, columns, points } = mesh
  const at = (row: number, column: number) => points[row * (columns + 1) + column]
  return (point) => {
    const gx = ((point.x - box.x) / Math.max(box.width, 1e-9)) * columns
    const gy = ((point.y - box.y) / Math.max(box.height, 1e-9)) * rows
    const column = Math.max(0, Math.min(columns - 1, Math.floor(gx)))
    const row = Math.max(0, Math.min(rows - 1, Math.floor(gy)))
    const s = gx - column
    const t = gy - row
    const a = at(row, column)
    const b = at(row, column + 1)
    const c = at(row + 1, column)
    const d = at(row + 1, column + 1)
    const top = cubicAt(a, handleEnd(a, 'right', b), handleEnd(b, 'left', a), b, s)
    const bottom = cubicAt(c, handleEnd(c, 'right', d), handleEnd(d, 'left', c), d, s)
    const left = cubicAt(a, handleEnd(a, 'down', c), handleEnd(c, 'up', a), c, t)
    const right = cubicAt(b, handleEnd(b, 'down', d), handleEnd(d, 'up', b), d, t)
    const corner = (key: 'x' | 'y') =>
      (1 - s) * (1 - t) * a[key] + s * (1 - t) * b[key] + (1 - s) * t * c[key] + s * t * d[key]
    return {
      x: (1 - t) * top.x + t * bottom.x + (1 - s) * left.x + s * right.x - corner('x'),
      y: (1 - t) * top.y + t * bottom.y + (1 - s) * left.y + s * right.y - corner('y')
    }
  }
}

/** A mesh stored against a box (0…1 both ways) placed in `box`. */
export function meshInBox(
  box: Rect,
  rows: number,
  columns: number,
  points: readonly MeshPoint[]
): EnvelopeMesh {
  const scale = (offset: Vector | undefined) =>
    offset ? { x: offset.x * box.width, y: offset.y * box.height } : undefined
  return {
    rows,
    columns,
    points: points.map((point) => ({
      x: box.x + point.x * box.width,
      y: box.y + point.y * box.height,
      left: scale(point.left),
      right: scale(point.right),
      up: scale(point.up),
      down: scale(point.down)
    }))
  }
}

/** The flat mesh of `rows` by `columns` cells in box units (0…1 both ways). */
export function flatMeshPoints(rows: number, columns: number): MeshPoint[] {
  return flatMesh({ x: 0, y: 0, width: 1, height: 1 }, rows, columns).points
}

/**
 * A mesh of another size that bends as `points` did: each new grid point is where the old mesh
 * took that place in the box, with straight handles, as Illustrator adds rows and columns.
 */
export function resampleMesh(
  rows: number,
  columns: number,
  points: readonly MeshPoint[],
  nextRows: number,
  nextColumns: number
): MeshPoint[] {
  const unit = { x: 0, y: 0, width: 1, height: 1 }
  const map = meshFunction(unit, meshInBox(unit, rows, columns, points))
  return flatMeshPoints(nextRows, nextColumns).map((point) => map(point))
}

/** Splits a cubic at `t`: the control points and end of each half. */
function splitCubic(
  p0: Vector,
  [p1, p2, p3]: [Vector, Vector, Vector],
  t: number
): [[Vector, Vector, Vector], [Vector, Vector, Vector]] {
  const { left, right } = splitCubicAt(p0, p1, p2, p3, t)
  return [
    [left.cp1, left.cp2, left.p3],
    [right.cp1, right.cp2, right.p3]
  ]
}

/**
 * Cuts every segment into pieces no longer than `step`, so a warp, which bends straight lines,
 * bends them smoothly: each piece's control points are moved with its end points.
 */
export function subdivideContour(
  contour: CubicContour,
  step: number,
  maxPieces = 64
): CubicContour {
  const segments: [Vector, Vector, Vector][] = []
  let from = contour.start
  for (const segment of contour.segments) {
    const pieces = Math.max(
      1,
      Math.min(maxPieces, Math.ceil(controlPolygonLength(from, ...segment) / step))
    )
    let rest = segment
    let restStart = from
    for (let piece = pieces; piece > 1; piece--) {
      const [head, tail] = splitCubic(restStart, rest, 1 / piece)
      segments.push(head)
      restStart = head[2]
      rest = tail
    }
    segments.push(rest)
    from = segment[2]
  }
  return { start: contour.start, segments, closed: contour.closed }
}

/** Every point of the contours moved by `map`, after cutting them into pieces of at most `step`. */
export function mapContours(
  contours: readonly CubicContour[],
  map: (point: Vector) => Vector,
  step: number
): CubicContour[] {
  return contours.map((contour) => {
    const fine = subdivideContour(contour, step)
    return {
      start: map(fine.start),
      segments: fine.segments.map(([c1, c2, end]) => [map(c1), map(c2), map(end)]),
      closed: fine.closed
    }
  })
}

/** The step a box is cut at for warping: fine enough for smooth curves, bounded in count. */
export function warpStep(box: Rect): number {
  return Math.max(1, Math.max(box.width, box.height) / 48)
}
