import type { Element } from '@xmldom/xmldom'

import type { Effect, Fill, SceneGraph, Stroke } from '@lawha/scene-graph'
import { BLACK } from '@lawha/scene-graph/constants'
import { ellipticalGradientTransform, linearGradientTransform } from '@lawha/scene-graph/gradient'
import { computeImageHash } from '@lawha/scene-graph/images'
import type { Color } from '@lawha/scene-graph/primitives'

import { EMU_PER_PX } from './text'
import { readColor, type PPTXTheme } from './theme'
import { attr, child, children, numAttr, relAttr, type OOXMLPackage } from './xml'

/** Shared by everything one part draws: where its images resolve, and the theme. */
export interface PaintContext {
  graph: SceneGraph
  pkg: OOXMLPackage
  theme: PPTXTheme
  /** The part (slide, layout, master) whose relationships `r:embed` names. */
  part: string
  /** Image hashes by media part, so a picture used twice is stored once. */
  images: Map<string, string | null>
}

/** Image types CanvasKit decodes; EMF and WMF previews are left out. */
const DECODABLE_IMAGE = /\.(png|jpe?g|gif|webp|bmp)$/i

const ANGLE_UNIT = 60000

function solid(color: Color): Fill {
  return { type: 'SOLID', color: { ...color }, opacity: 1, visible: true }
}

/** A colour with no alpha left draws nothing. */
export function visibleSolid(color: Color | null): Fill[] {
  return color && color.a > 0 ? [solid(color)] : []
}

/** The image a relationship id names, stored in the graph; null for a format we cannot draw. */
export function imageHash(ctx: PaintContext, embed: string | null): string | null {
  if (!embed) return null
  const rel = ctx.pkg.rels(ctx.part).get(embed)
  if (!rel || rel.external || !DECODABLE_IMAGE.test(rel.target)) return null
  const cached = ctx.images.get(rel.target)
  if (cached !== undefined) return cached
  const bytes = ctx.pkg.bytes(rel.target)
  const hash = bytes ? computeImageHash(bytes) : null
  if (bytes && hash) ctx.graph.images.set(hash, bytes)
  ctx.images.set(rel.target, hash)
  return hash
}

export function imageFill(ctx: PaintContext, blipFill: Element | undefined): Fill | null {
  const blip = child(blipFill, 'blip')
  const hash = imageHash(ctx, relAttr(blip, 'embed'))
  if (!hash) return null
  const alpha = numAttr(child(blip, 'alphaModFix'), 'amt')
  return {
    type: 'IMAGE',
    imageHash: hash,
    imageScaleMode: 'FILL',
    color: { ...BLACK },
    opacity: alpha === null ? 1 : alpha / 100000,
    visible: true
  }
}

function gradientFill(fill: Element, theme: PPTXTheme, width: number, height: number): Fill | null {
  const stops = children(child(fill, 'gsLst'), 'gs')
    .map((gs) => ({
      position: (numAttr(gs, 'pos') ?? 0) / 100000,
      color: readColor(children(gs)[0], theme)
    }))
    .filter((stop): stop is { position: number; color: Color } => stop.color !== null)
    .sort((a, b) => a.position - b.position)
  if (stops.length === 0) return null
  const path = attr(child(fill, 'path'), 'path')
  if (path === 'circle' || path === 'shape' || path === 'rect') {
    return {
      type: 'GRADIENT_RADIAL',
      color: { ...stops[0].color },
      gradientStops: stops,
      gradientTransform: ellipticalGradientTransform(
        { x: 0.5, y: 0.5 },
        { x: 1, y: 0.5 },
        { x: 0.5, y: 1 }
      ),
      opacity: 1,
      visible: true
    }
  }
  // `a:lin/@ang` turns clockwise from left to right.
  const angle = (((numAttr(child(fill, 'lin'), 'ang') ?? 0) / ANGLE_UNIT) * Math.PI) / 180
  const dx = Math.cos(angle) / 2
  const dy = Math.sin(angle) / 2
  return {
    type: 'GRADIENT_LINEAR',
    color: { ...stops[0].color },
    gradientStops: stops,
    gradientTransform: linearGradientTransform(
      { x: 0.5 - dx, y: 0.5 - dy },
      { x: 0.5 + dx, y: 0.5 + dy },
      Math.max(width, 1),
      Math.max(height, 1)
    ),
    opacity: 1,
    visible: true
  }
}

/**
 * The fill an element holding paint (`p:spPr`, `p:bgPr`, `a:rPr`) gives, or null when it names
 * none, so the shape style or a placeholder decides.
 */
export function readFills(
  ctx: PaintContext,
  el: Element | undefined,
  size: { width: number; height: number }
): Fill[] | null {
  for (const paint of children(el)) {
    switch (paint.localName) {
      case 'noFill':
        return []
      case 'solidFill':
        return visibleSolid(readColor(children(paint)[0], ctx.theme))
      case 'gradFill': {
        const fill = gradientFill(paint, ctx.theme, size.width, size.height)
        return fill ? [fill] : []
      }
      case 'blipFill': {
        const fill = imageFill(ctx, paint)
        return fill ? [fill] : []
      }
      default:
        break
    }
  }
  return null
}

/** A `p:style` reference's colour (`a:fillRef`, `a:lnRef`, `a:fontRef`), when its index is set. */
export function styleRefColor(
  style: Element | undefined,
  name: 'fillRef' | 'lnRef' | 'fontRef' | 'bgRef',
  theme: PPTXTheme
): Color | null {
  const ref = child(style, name)
  if (!ref) return null
  if (name !== 'fontRef' && (numAttr(ref, 'idx') ?? 0) === 0) return null
  return readColor(children(ref)[0], theme)
}

const DASHES: Partial<Record<string, number[]>> = {
  dash: [4, 3],
  lgDash: [8, 3],
  sysDash: [3, 1],
  dot: [1, 3],
  sysDot: [1, 1],
  dashDot: [4, 3, 1, 3],
  lgDashDot: [8, 3, 1, 3],
  sysDashDot: [3, 1, 1, 1]
}

const CAPS: Partial<Record<string, Stroke['cap']>> = { rnd: 'ROUND', sq: 'SQUARE' }

/** The stroke of `a:ln`, falling back to the shape style's line reference. */
export function readStrokes(
  ctx: PaintContext,
  ln: Element | undefined,
  style: Element | undefined
): Stroke[] {
  const ref = child(style, 'lnRef')
  const refIndex = numAttr(ref, 'idx') ?? 0
  const width =
    numAttr(ln, 'w') ?? (refIndex > 0 ? (ctx.theme.lineWidths[refIndex - 1] ?? 9525) : 9525)
  let fills = readFills(ctx, ln, { width: 1, height: 1 })
  if (fills === null) fills = visibleSolid(styleRefColor(style, 'lnRef', ctx.theme))
  const paint = fills.at(0)
  if (!paint || width <= 0) return []
  const weight = Math.round((width / EMU_PER_PX) * 100) / 100
  const dash = DASHES[attr(child(ln, 'prstDash'), 'val') ?? 'solid']
  const cap = CAPS[attr(ln, 'cap') ?? 'flat']
  const stroke: Stroke = { ...paint, weight, align: 'CENTER' }
  if (cap) stroke.cap = cap
  if (dash) stroke.dashPattern = dash.map((step) => step * weight)
  return [stroke]
}

const SHADOWS: Partial<Record<string, Effect['type']>> = {
  outerShdw: 'DROP_SHADOW',
  innerShdw: 'INNER_SHADOW'
}

/** Outer and inner shadows of `a:effectLst`. */
export function readEffects(ctx: PaintContext, spPr: Element | undefined): Effect[] {
  const effects: Effect[] = []
  for (const effect of children(child(spPr, 'effectLst'))) {
    const type = SHADOWS[effect.localName ?? '']
    if (!type) continue
    const color = readColor(children(effect)[0], ctx.theme)
    if (!color) continue
    const distance = (numAttr(effect, 'dist') ?? 0) / EMU_PER_PX
    const angle = (((numAttr(effect, 'dir') ?? 0) / ANGLE_UNIT) * Math.PI) / 180
    effects.push({
      type,
      color,
      offset: {
        x: Math.round(distance * Math.cos(angle) * 100) / 100,
        y: Math.round(distance * Math.sin(angle) * 100) / 100
      },
      radius: Math.round(((numAttr(effect, 'blurRad') ?? 0) / EMU_PER_PX) * 100) / 100,
      spread: 0,
      visible: true
    })
  }
  return effects
}
