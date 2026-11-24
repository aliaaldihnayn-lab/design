import type { Justification, LayerTextData, TextStyle } from 'ag-psd'
import { isEqual } from 'es-toolkit'

import type { CharacterStyleOverride, SceneNode, StyleRun } from '@lawha/scene-graph'
import { detectTextDirection } from '@lawha/scene-graph/text/direction'

import { parsePDFFontName } from '#core/io/formats/pdf/import/font-name'

import { psdColor } from './color'

/**
 * A Photoshop text layer as live text, placed where Photoshop lays it out: point text by its
 * layout bounds around the anchor, sized to its text so it never wraps, and paragraph text by its
 * box, growing taller rather than spilling out of it. Both turn and scale with the layer's
 * transform, and keep their alignment, direction, leading, tracking and per-run styles.
 */

const ALIGN: Record<Justification, SceneNode['textAlignHorizontal']> = {
  left: 'LEFT',
  right: 'RIGHT',
  center: 'CENTER',
  'justify-left': 'JUSTIFIED',
  'justify-right': 'JUSTIFIED',
  'justify-center': 'JUSTIFIED',
  'justify-all': 'JUSTIFIED'
}

const round = (value: number) => Math.round(value * 100) / 100

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** The text's box in the text's own space, before its transform: paragraph box or layout bounds. */
function localBox(text: LayerTextData): Rect | null {
  if (text.shapeType === 'box' && text.boxBounds && text.boxBounds.length >= 4) {
    const [left, top, right, bottom] = text.boxBounds
    return { x: left, y: top, width: right - left, height: bottom - top }
  }
  const bounds = text.bounds
  if (!bounds) return null
  const width = bounds.right.value - bounds.left.value
  const height = bounds.bottom.value - bounds.top.value
  if (!(width > 0 && height > 0)) return null
  return { x: bounds.left.value, y: bounds.top.value, width, height }
}

export interface TextPlacement {
  x: number
  y: number
  width: number
  height: number
  rotation: number
  /** How much the transform scales the text's type size. */
  scale: number
}

/**
 * Where a text layer's box sits on the canvas: its local box mapped through the layer's transform
 * (`[xx, xy, yx, yy, tx, ty]`), as an upright box turned about its centre. Null when the layer
 * names no box to place, and the caller falls back to its drawn pixels.
 */
export function textPlacement(text: LayerTextData): TextPlacement | null {
  const box = localBox(text)
  if (!box) return null
  const [a = 1, b = 0, c = 0, d = 1, tx = 0, ty = 0] = text.transform ?? []
  const scaleX = Math.hypot(a, b)
  const scaleY = Math.hypot(c, d)
  if (scaleX === 0 || scaleY === 0) return null
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  const centerX = a * cx + c * cy + tx
  const centerY = b * cx + d * cy + ty
  const width = box.width * scaleX
  const height = box.height * scaleY
  const degrees = (Math.atan2(b, a) * 180) / Math.PI
  return {
    x: round(centerX - width / 2),
    y: round(centerY - height / 2),
    width: round(width),
    height: round(height),
    rotation: Math.abs(degrees) < 1e-3 ? 0 : round(degrees),
    scale: scaleY
  }
}

type CharacterProps = Required<
  Pick<CharacterStyleOverride, 'fontFamily' | 'fontSize' | 'fontWeight' | 'italic' | 'fills'>
> &
  Pick<CharacterStyleOverride, 'letterSpacing' | 'lineHeight' | 'textDecoration'>

function characterProps(style: TextStyle, scale: number, opacity: number): CharacterProps {
  const face = style.font?.name ? parsePDFFontName(style.font.name) : null
  const size = (style.fontSize ?? 16) * scale
  const props: CharacterProps = {
    fontFamily: face?.family ?? 'Inter',
    fontSize: round(size),
    fontWeight: face?.weight ?? (style.fauxBold ? 700 : 400),
    italic: (face?.italic ?? false) || (style.fauxItalic ?? false),
    fills: [{ type: 'SOLID', color: psdColor(style.fillColor), opacity, visible: true }]
  }
  // Tracking is in thousandths of an em.
  if (style.tracking) props.letterSpacing = { value: round(style.tracking / 10), unit: 'PERCENT' }
  if (style.autoLeading === false && style.leading) {
    props.lineHeight = { value: round(style.leading * scale), unit: 'PIXELS' }
  }
  if (style.underline) props.textDecoration = 'UNDERLINE'
  else if (style.strikethrough) props.textDecoration = 'STRIKETHROUGH'
  return props
}

/** What a run's style changes from the text's own. */
function override(run: CharacterProps, base: CharacterProps): CharacterStyleOverride {
  const changed: CharacterStyleOverride = {}
  for (const key of Object.keys(run) as (keyof CharacterProps)[]) {
    if (!isEqual(run[key], base[key])) {
      Object.assign(changed, { [key]: run[key] })
    }
  }
  return changed
}

/**
 * The text node properties of a text layer, apart from its place: its characters, base style,
 * the runs that differ from it, alignment and direction.
 */
export function textProps(
  text: LayerTextData,
  scale: number,
  opacity: number,
  pointText: boolean
): Partial<SceneNode> {
  const content = text.text.replace(/\r\n?/g, '\n').replace(/\n$/, '')
  const runs = text.styleRuns ?? []
  // The text takes the style its first run starts with, as Photoshop's own `style` does.
  const base = characterProps({ ...text.style, ...runs[0]?.style }, scale, opacity)
  const styleRuns: StyleRun[] = []
  let start = 0
  for (const run of runs) {
    const length = Math.min(run.length, content.length - start)
    if (length <= 0) break
    const style = override(characterProps({ ...text.style, ...run.style }, scale, opacity), base)
    if (Object.keys(style).length > 0) styleRuns.push({ start, length, style })
    start += run.length
  }
  const justification = text.paragraphStyle?.justification ?? 'left'
  return {
    text: content,
    ...base,
    styleRuns,
    textAlignHorizontal: ALIGN[justification],
    textDirection: detectTextDirection(content),
    // Point text never wraps; paragraph text wraps in its box and grows rather than spill.
    textAutoResize: pointText ? 'WIDTH_AND_HEIGHT' : 'HEIGHT'
  }
}
