import type { Vector } from '@lawha/scene-graph/primitives'

import type { Loop } from './contours'

/** How far a simplified outline may stray from the pixel staircase, and where corners stay sharp. */
export interface FitOptions {
  /** Largest distance, in pixels, a dropped point may lie from the simplified outline. */
  tolerance: number
  /** Turns sharper than this, in radians, stay corners instead of being smoothed. */
  cornerAngle: number
  /** The image's size: outline corners on its edge stay where they are. */
  width: number
  height: number
}

function distanceToSegment(p: Vector, a: Vector, b: Vector): number {
  const vx = b.x - a.x
  const vy = b.y - a.y
  const length = vx * vx + vy * vy
  if (length === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / length))
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy))
}

/** Ramer–Douglas–Peucker over an open run of points, keeping both ends. */
function simplifyRun(points: readonly Vector[], tolerance: number): Vector[] {
  if (points.length < 3) return [...points]
  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1
  const stack: [number, number][] = [[0, points.length - 1]]
  while (stack.length > 0) {
    const [first, last] = stack.pop() ?? [0, 0]
    let farthest = -1
    let farthestDistance = tolerance
    for (let i = first + 1; i < last; i++) {
      const distance = distanceToSegment(points[i], points[first], points[last])
      if (distance > farthestDistance) {
        farthest = i
        farthestDistance = distance
      }
    }
    if (farthest < 0) continue
    keep[farthest] = 1
    stack.push([first, farthest], [farthest, last])
  }
  return points.filter((_, index) => keep[index] === 1)
}

/**
 * A closed loop simplified: the midpoints of its pixel edges, which smooth the staircase, then
 * Ramer–Douglas–Peucker split at the point farthest from the start so the loop closes cleanly.
 */
export function simplifyLoop(
  loop: Loop,
  tolerance: number,
  frame: { width: number; height: number }
): Vector[] {
  const mids: Vector[] = []
  for (const [i, point] of loop.entries()) {
    // A corner of the image itself stays square rather than being cut off.
    const onX = point.x === 0 || point.x === frame.width
    const onY = point.y === 0 || point.y === frame.height
    if (onX && onY) mids.push(point)
    const next = loop[(i + 1) % loop.length]
    mids.push({ x: (point.x + next.x) / 2, y: (point.y + next.y) / 2 })
  }
  let far = 0
  let farDistance = -1
  for (const [index, point] of mids.entries()) {
    const distance = Math.hypot(point.x - mids[0].x, point.y - mids[0].y)
    if (distance > farDistance) {
      far = index
      farDistance = distance
    }
  }
  const first = simplifyRun(mids.slice(0, far + 1), tolerance)
  const second = simplifyRun([...mids.slice(far), mids[0]], tolerance)
  const simplified = [...first, ...second.slice(1, -1)]
  // A loop round a pixel or two has nothing to drop; simplifying would leave no area.
  return simplified.length >= 3 ? simplified : mids
}

function turnAngle(previous: Vector, point: Vector, next: Vector): number {
  const a = Math.atan2(point.y - previous.y, point.x - previous.x)
  const b = Math.atan2(next.y - point.y, next.x - point.x)
  let turn = Math.abs(b - a)
  if (turn > Math.PI) turn = 2 * Math.PI - turn
  return turn
}

const format = (n: number) => String(Math.round(n * 100) / 100)

/**
 * SVG path data for a loop fitted with cubic curves: smooth points take Catmull-Rom tangents,
 * corners sharper than the corner angle keep straight sides.
 */
export function fitLoopPath(loop: Loop, options: FitOptions): string {
  const points = simplifyLoop(loop, options.tolerance, options)
  const n = points.length
  if (n < 3) return ''
  const corner = points.map(
    (point, i) =>
      turnAngle(points[(i - 1 + n) % n], point, points[(i + 1) % n]) > options.cornerAngle
  )
  const tangent = points.map((_, i) => {
    if (corner[i]) return { x: 0, y: 0 }
    const previous = points[(i - 1 + n) % n]
    const next = points[(i + 1) % n]
    return { x: (next.x - previous.x) / 2, y: (next.y - previous.y) / 2 }
  })
  let d = `M${format(points[0].x)} ${format(points[0].y)}`
  for (let i = 0; i < n; i++) {
    const a = points[i]
    const b = points[(i + 1) % n]
    const ta = tangent[i]
    const tb = tangent[(i + 1) % n]
    if (corner[i] && corner[(i + 1) % n]) {
      d += `L${format(b.x)} ${format(b.y)}`
      continue
    }
    d += `C${format(a.x + ta.x / 3)} ${format(a.y + ta.y / 3)} ${format(b.x - tb.x / 3)} ${format(b.y - tb.y / 3)} ${format(b.x)} ${format(b.y)}`
  }
  return `${d}Z`
}
