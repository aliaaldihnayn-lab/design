import type { Canvas, Paint } from 'canvaskit-wasm'

import type { SceneGraph } from '@lawha/scene-graph'

import { inNodeSpace, withScreenStroke } from '#core/canvas/overlays/outline'
import type { SkiaRenderer } from '#core/canvas/renderer'
import type { PixelOverlay } from '#core/editor/pixels/types'
import { createSceneGeometry } from '#core/geometry'

const ANT_DASH = [4, 4] as const
const WHITE = Float32Array.of(1, 1, 1, 1)
const BLACK = Float32Array.of(0, 0, 0, 1)

/**
 * Draws a line twice, black and then white dashes over it, so it reads on any picture: the
 * marching ants of a pixel selection.
 */
function withAnts(r: SkiaRenderer, draw: (paint: Paint) => void) {
  withScreenStroke(r, { color: BLACK }, draw)
  withScreenStroke(r, { color: WHITE, dash: ANT_DASH }, draw)
}

/**
 * The pixel tools' chrome: the selection outline on its layer, the selection shape being dragged,
 * the brush's outline under the pointer, and the clone source's crosshair.
 */
export function drawPixelOverlay(
  r: SkiaRenderer,
  canvas: Canvas,
  graph: SceneGraph,
  overlay: PixelOverlay | null | undefined
): void {
  if (!overlay) return
  const node = overlay.nodeId ? graph.getNode(overlay.nodeId) : undefined
  if (node && overlay.outline && overlay.outline.length > 0 && overlay.grid) {
    const { outline, grid } = overlay
    inNodeSpace(r, canvas, createSceneGeometry(graph), node, () => {
      const sx = node.width / grid.width
      const sy = node.height / grid.height
      const path = new r.ck.PathBuilder()
      for (let i = 0; i + 3 < outline.length; i += 4) {
        path.moveTo(outline[i] * sx, outline[i + 1] * sy)
        path.lineTo(outline[i + 2] * sx, outline[i + 3] * sy)
      }
      const built = path.detachAndDelete()
      withAnts(r, (paint) => canvas.drawPath(built, paint))
      built.delete()
    })
  }

  canvas.save()
  try {
    canvas.translate(r.panX, r.panY)
    canvas.scale(r.zoom, r.zoom)
    const { marquee, brush, cloneSource } = overlay
    if (marquee) {
      const rect = r.ck.LTRBRect(
        Math.min(marquee.from.x, marquee.to.x),
        Math.min(marquee.from.y, marquee.to.y),
        Math.max(marquee.from.x, marquee.to.x),
        Math.max(marquee.from.y, marquee.to.y)
      )
      withAnts(r, (paint) => {
        if (marquee.kind === 'ellipse') canvas.drawOval(rect, paint)
        else canvas.drawRect(rect, paint)
      })
    }
    if (brush && brush.radius > 0) {
      withAnts(r, (paint) => canvas.drawCircle(brush.x, brush.y, brush.radius, paint))
    }
    if (cloneSource) {
      const arm = 8 / r.zoom
      withAnts(r, (paint) => {
        canvas.drawLine(
          cloneSource.x - arm,
          cloneSource.y,
          cloneSource.x + arm,
          cloneSource.y,
          paint
        )
        canvas.drawLine(
          cloneSource.x,
          cloneSource.y - arm,
          cloneSource.x,
          cloneSource.y + arm,
          paint
        )
      })
    }
  } finally {
    canvas.restore()
  }
}
