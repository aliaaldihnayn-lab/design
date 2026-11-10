import type { Canvas } from 'canvaskit-wasm'

import type { RenderOverlays, SkiaRenderer } from '#core/canvas/renderer'
import { MEASUREMENT_COLOR, SELECTION_COLOR } from '#core/constants'

/** How much of a region a Shape Builder highlight covers with its colour. */
const SHAPE_BUILDER_FILL_ALPHA = 0.28
/** The highlight's outline, in screen pixels. */
const SHAPE_BUILDER_OUTLINE = 1.5

/**
 * The regions the Shape Builder tool would merge, tinted in the selection colour, or delete, in
 * red, as Illustrator shades them under the pointer.
 */
export function drawShapeBuilderHover(
  r: SkiaRenderer,
  canvas: Canvas,
  hover: RenderOverlays['shapeBuilderHover']
): void {
  if (!hover || hover.paths.length === 0) return
  const color = hover.mode === 'delete' ? MEASUREMENT_COLOR : SELECTION_COLOR
  const fill = new r.ck.Paint()
  fill.setAntiAlias(true)
  fill.setStyle(r.ck.PaintStyle.Fill)
  fill.setColorComponents(color.r, color.g, color.b, SHAPE_BUILDER_FILL_ALPHA)
  const outline = new r.ck.Paint()
  outline.setAntiAlias(true)
  outline.setStyle(r.ck.PaintStyle.Stroke)
  outline.setStrokeWidth(SHAPE_BUILDER_OUTLINE)
  outline.setColorComponents(color.r, color.g, color.b, 1)
  for (const data of hover.paths) {
    const path = r.ck.Path.MakeFromSVGString(data)
    if (!path) continue
    const builder = new r.ck.PathBuilder()
    builder.addPath(path, [r.zoom, 0, r.panX, 0, r.zoom, r.panY, 0, 0, 1])
    path.delete()
    const screen = builder.detachAndDelete()
    canvas.drawPath(screen, fill)
    canvas.drawPath(screen, outline)
    screen.delete()
  }
  fill.delete()
  outline.delete()
}
