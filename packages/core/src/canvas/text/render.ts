import type { Canvas } from 'canvaskit-wasm'

import type { Fill, SceneNode, Stroke } from '@lawha/scene-graph'
import type { Color } from '@lawha/scene-graph/primitives'

import type { SkiaRenderer } from '#core/canvas/renderer'
import { textVerticalOffset, withTextParagraph } from '#core/canvas/text'
import { DEFAULT_FONT_SIZE } from '#core/constants'
import { shownText } from '#core/text/case'
import { mayHoldEmoji } from '#core/text/emoji'

import { drawTextLayout } from './decorations'
import { canDrawSavedText, drawDerivedText, drawsSavedText } from './derived'
import { drawLaidOutEmoji, drawSavedEmoji } from './emoji'

export function hasOverflowPathTextPaint(node: SceneNode): boolean {
  return (
    node.textPathData != null &&
    ((node.derivedTextGlyphs?.length ?? 0) > 0 ||
      (Array.isArray(node.strokeGeometry) && node.strokeGeometry.length > 0))
  )
}

function hasComplexTextFill(fill?: Fill): boolean {
  return fill !== undefined && fill.type !== 'SOLID'
}

function drawPaintedText(r: SkiaRenderer, canvas: Canvas, node: SceneNode): boolean {
  if (!r.fontsLoaded || !r.fontProvider) return false
  // Apply the shader directly to native glyphs: coverage layers add another rounding pass.
  return withTextParagraph(
    r,
    node,
    r.ck.Color4f(0, 0, 0, 1),
    {
      halfLeading: true,
      foregroundPaint: r.fillPaint
    },
    (paragraph, prepared) => {
      const y = textVerticalOffset(node, paragraph.getHeight())
      drawTextLayout(r.ck, canvas, node, prepared, y, r.fillPaint)
      return true
    }
  )
}

/**
 * Strokes a text's laid-out glyphs, for text whose glyphs have no outlines to stroke as paths
 * (complex scripts such as Arabic, fallback fonts). A stroke aligned to one side is drawn at twice
 * its weight and the glyphs then cut it to that side, as a path stroke is clipped.
 */
export function strokeLaidOutText(
  r: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode,
  stroke: Stroke,
  color: Color
): boolean {
  if (!r.fontsLoaded || !r.fontProvider || node.textPathData !== null) return false
  const sided = stroke.align !== 'CENTER'
  const pen = new r.ck.Paint()
  const cut = new r.ck.Paint()
  try {
    pen.setAntiAlias(true)
    pen.setStyle(r.ck.PaintStyle.Stroke)
    pen.setStrokeWidth(sided ? stroke.weight * 2 : stroke.weight)
    pen.setStrokeJoin(r.ck.StrokeJoin.Round)
    pen.setColorComponents(color.r, color.g, color.b, color.a)
    cut.setAntiAlias(true)
    cut.setBlendMode(stroke.align === 'INSIDE' ? r.ck.BlendMode.DstIn : r.ck.BlendMode.DstOut)
    const draw = (paint: typeof pen) =>
      withTextParagraph(
        r,
        node,
        r.ck.Color4f(0, 0, 0, 1),
        { halfLeading: true, foregroundPaint: paint },
        (paragraph) => {
          paragraph.draw(canvas, 0, textVerticalOffset(node, paragraph.getHeight()))
          return true
        }
      )
    const layer = new r.ck.Paint()
    layer.setAlphaf(stroke.opacity)
    canvas.saveLayer(layer)
    layer.delete()
    const drawn = draw(pen)
    if (drawn && sided) draw(cut)
    canvas.restore()
    return drawn
  } finally {
    pen.delete()
    cut.delete()
  }
}

function drawResolvedPathText(
  r: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode,
  fontReadiness: ReturnType<SkiaRenderer['nodeFontReadiness']>,
  fill?: Fill
): boolean {
  return (
    // Resolving the exact face must not replace curved glyph placement with a straight paragraph.
    fontReadiness !== 'exhausted' &&
    node.textPathData !== null &&
    drawDerivedText(r, canvas, node, fill)
  )
}

/** Whether the text is drawn from the editor's own layout, which leaves its emoji to be drawn. */
function drawsLaidOutText(r: SkiaRenderer, node: SceneNode): boolean {
  if (!r.fontsLoaded || !r.fontProvider || node.textPathData !== null) return false
  const readiness = r.nodeFontReadiness(node)
  // Edited text draws its paragraph even after its fonts gave up, so its emoji draw over it too.
  const laidOut = readiness !== 'pending' && (readiness !== 'exhausted' || !drawsSaved(r, node))
  return laidOut && mayHoldEmoji(shownText(node))
}

/**
 * The emoji of a text, once whatever fills it has: over its saved glyphs' placeholder squares, or
 * over the blank squares the editor's layout gives them.
 */
export function drawTextEmoji(r: SkiaRenderer, canvas: Canvas, node: SceneNode): void {
  const saved = drawsSaved(r, node) && drawsSavedText(node)
  if (!saved && !drawsLaidOutText(r, node)) return
  canvas.save()
  if (saved) drawSavedEmoji(r, canvas, node)
  else {
    // The paragraph the fills just drew with: its colour keys the prepared text, and a solid fill
    // leaves it on the fill paint, so no second paragraph is shaped for the emoji.
    const lastFill = node.fills.findLast((fill) => fill.visible)
    const color = hasComplexTextFill(lastFill) ? r.ck.Color4f(0, 0, 0, 1) : r.fillPaint.getColor()
    withTextParagraph(r, node, color, { halfLeading: true }, (paragraph) =>
      drawLaidOutEmoji(r, canvas, node, paragraph, textVerticalOffset(node, paragraph.getHeight()))
    )
  }
  canvas.restore()
}

/**
 * Whether the text draws from its saved glyphs. Text whose fonts are all loaded lays out live, as
 * Figma lays text out with its own fonts, so an edit changes nothing but the characters; saved
 * glyphs stand in for a missing or substituted font and keep path text on its path. Not while the
 * text is edited either: the caret, selection, and hit testing follow the live layout.
 */
function drawsSaved(r: SkiaRenderer, node: SceneNode): boolean {
  const readiness = r.nodeFontReadiness(node)
  // Fonts still loading leave nothing else to draw, edited or not.
  if (readiness === 'pending') return true
  if (r.editingTextId === node.id) return false
  return node.textPathData !== null || readiness !== 'ready'
}

function drawSavedText(r: SkiaRenderer, canvas: Canvas, node: SceneNode, fill?: Fill): boolean {
  return (
    drawsSaved(r, node) && canDrawSavedText(node, fill) && drawDerivedText(r, canvas, node, fill)
  )
}

export function renderText(r: SkiaRenderer, canvas: Canvas, node: SceneNode, fill?: Fill): void {
  const text = node.text
  if (!text) return

  canvas.save()

  if (drawSavedText(r, canvas, node, fill)) {
    canvas.restore()
    return
  }
  const fontReadiness = r.nodeFontReadiness(node)
  if (fontReadiness === 'pending') {
    canvas.restore()
    return
  }
  if (drawResolvedPathText(r, canvas, node, fontReadiness, fill)) {
    canvas.restore()
    return
  }
  if (fontReadiness === 'exhausted' && drawsSaved(r, node)) {
    if (node.textPicture && r.isTextPictureCurrent(node)) {
      const pic = r.ck.MakePicture(node.textPicture)
      if (pic) {
        canvas.drawPicture(pic)
        pic.delete()
        canvas.restore()
        return
      }
    }
    if (drawDerivedText(r, canvas, node, fill)) {
      canvas.restore()
      return
    }
    canvas.restore()
    return
  }
  if (hasComplexTextFill(fill) && drawPaintedText(r, canvas, node)) {
    canvas.restore()
    return
  }
  if (r.fontsLoaded && r.fontProvider) {
    withTextParagraph(
      r,
      node,
      r.fillPaint.getColor(),
      { halfLeading: true },
      (paragraph, prepared) => {
        const paragraphY = textVerticalOffset(node, paragraph.getHeight())
        drawTextLayout(r.ck, canvas, node, prepared, paragraphY, r.fillPaint)
      }
    )
  } else if (r.chromeFonts.text) {
    const fontSize = node.fontSize || DEFAULT_FONT_SIZE
    const paragraphY = textVerticalOffset(node, fontSize)
    canvas.drawText(shownText(node), 0, paragraphY + fontSize, r.fillPaint, r.chromeFonts.text)
  }

  canvas.restore()
}
