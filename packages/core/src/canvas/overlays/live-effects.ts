import type { Canvas } from 'canvaskit-wasm'

import type { LiveEffectHandles } from '#core/canvas/live-effect-handles'
import type { SkiaRenderer } from '#core/canvas/renderer'
import { SELECTION_COLOR } from '#core/constants'

/** A mesh or width point's square, in screen pixels across. */
const POINT_SIZE = 7
/** A curve handle's dot, in screen pixels across. */
const HANDLE_SIZE = 5
/** Lines of the mesh and handle arms, in screen pixels. */
const LINE_WIDTH = 1

/**
 * A live effect's on-canvas handles, in the selection colour: an envelope mesh's edges, points,
 * and curve handles, or a width profile's centre line with each width point and the two ends of
 * its width, as Illustrator draws them.
 */
export function drawLiveEffectHandles(
  r: SkiaRenderer,
  canvas: Canvas,
  handles: LiveEffectHandles | null | undefined
): void {
  if (!handles) return
  const toScreen = (x: number, y: number) => ({ x: x * r.zoom + r.panX, y: y * r.zoom + r.panY })
  const line = new r.ck.Paint()
  line.setAntiAlias(true)
  line.setStyle(r.ck.PaintStyle.Stroke)
  line.setStrokeWidth(LINE_WIDTH)
  line.setColorComponents(SELECTION_COLOR.r, SELECTION_COLOR.g, SELECTION_COLOR.b, 1)
  const fill = new r.ck.Paint()
  fill.setAntiAlias(true)
  fill.setStyle(r.ck.PaintStyle.Fill)
  fill.setColorComponents(1, 1, 1, 1)
  const solid = new r.ck.Paint()
  solid.setAntiAlias(true)
  solid.setStyle(r.ck.PaintStyle.Fill)
  solid.setColorComponents(SELECTION_COLOR.r, SELECTION_COLOR.g, SELECTION_COLOR.b, 1)
  const pathData = handles.kind === 'mesh' ? handles.grid : handles.centre
  const path = r.ck.Path.MakeFromSVGString(pathData)
  if (path) {
    const builder = new r.ck.PathBuilder()
    builder.addPath(path, [r.zoom, 0, r.panX, 0, r.zoom, r.panY, 0, 0, 1])
    path.delete()
    const screen = builder.detachAndDelete()
    canvas.drawPath(screen, line)
    screen.delete()
  }
  const square = (x: number, y: number, picked = false) => {
    const at = toScreen(x, y)
    const half = POINT_SIZE / 2
    const rect = r.ck.XYWHRect(at.x - half, at.y - half, POINT_SIZE, POINT_SIZE)
    canvas.drawRect(rect, picked ? solid : fill)
    canvas.drawRect(rect, line)
  }
  const dot = (x: number, y: number) => {
    const at = toScreen(x, y)
    canvas.drawCircle(at.x, at.y, HANDLE_SIZE / 2, solid)
  }
  const arm = (ax: number, ay: number, bx: number, by: number) => {
    const a = toScreen(ax, ay)
    const b = toScreen(bx, by)
    canvas.drawLine(a.x, a.y, b.x, b.y, line)
  }
  if (handles.kind === 'mesh') {
    for (const handle of handles.handles) {
      arm(handle.fromX, handle.fromY, handle.x, handle.y)
      dot(handle.x, handle.y)
    }
    for (const point of handles.points) square(point.x, point.y, point.picked)
  } else {
    for (const point of handles.points) {
      arm(point.left.x, point.left.y, point.right.x, point.right.y)
      dot(point.left.x, point.left.y)
      dot(point.right.x, point.right.y)
      square(point.x, point.y)
    }
  }
  line.delete()
  fill.delete()
  solid.delete()
}
