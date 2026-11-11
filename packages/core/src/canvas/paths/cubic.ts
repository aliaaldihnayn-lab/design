import type { CanvasKit, Path } from 'canvaskit-wasm'

import type { Vector } from '@lawha/scene-graph/primitives'

import { lerpPoint } from '#core/vector/curve-math'
import type { CubicContour } from '#core/vector/warp'

/** Control points of the cubic closest to a conic with weight `w`, exact for a parabola. */
function conicAsCubic(p0: Vector, p1: Vector, p2: Vector, w: number): [Vector, Vector, Vector] {
  const k = (4 * w) / (3 * (1 + w))
  return [
    { x: p0.x + k * (p1.x - p0.x), y: p0.y + k * (p1.y - p0.y) },
    { x: p2.x + k * (p1.x - p2.x), y: p2.y + k * (p1.y - p2.y) },
    p2
  ]
}

/** A path as runs of cubic curves: lines, quadratics, and conics are raised to cubics. */
export function pathToCubics(ck: CanvasKit, path: Path): CubicContour[] {
  const cmds = path.toCmds()
  const contours: CubicContour[] = []
  let current: CubicContour | null = null
  let at: Vector = { x: 0, y: 0 }
  const point = (i: number): Vector => ({ x: cmds[i], y: cmds[i + 1] })
  for (let i = 0; i < cmds.length;) {
    const verb = cmds[i]
    if (verb === ck.MOVE_VERB) {
      at = point(i + 1)
      current = { start: at, segments: [], closed: false }
      contours.push(current)
      i += 3
    } else if (verb === ck.LINE_VERB) {
      const end = point(i + 1)
      current?.segments.push([lerpPoint(at, end, 1 / 3), lerpPoint(at, end, 2 / 3), end])
      at = end
      i += 3
    } else if (verb === ck.QUAD_VERB) {
      const control = point(i + 1)
      const end = point(i + 3)
      current?.segments.push(conicAsCubic(at, control, end, 1))
      at = end
      i += 5
    } else if (verb === ck.CONIC_VERB) {
      const control = point(i + 1)
      const end = point(i + 3)
      current?.segments.push(conicAsCubic(at, control, end, cmds[i + 5]))
      at = end
      i += 6
    } else if (verb === ck.CUBIC_VERB) {
      const end = point(i + 5)
      current?.segments.push([point(i + 1), point(i + 3), end])
      at = end
      i += 7
    } else {
      if (current) {
        current.closed = true
        at = current.start
      }
      i += 1
    }
  }
  return contours.filter((contour) => contour.segments.length > 0)
}

/** Runs of cubics as a path with `fillType`. */
export function cubicsToPath(
  ck: CanvasKit,
  contours: readonly CubicContour[],
  fillType = ck.FillType.Winding
): Path {
  const builder = new ck.PathBuilder()
  for (const { start, segments, closed } of contours) {
    builder.moveTo(start.x, start.y)
    for (const [c1, c2, end] of segments) builder.cubicTo(c1.x, c1.y, c2.x, c2.y, end.x, end.y)
    if (closed) builder.close()
  }
  const path = builder.detachAndDelete()
  path.setFillType(fillType)
  return path
}
