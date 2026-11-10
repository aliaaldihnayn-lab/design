import type {
  BlendMode as PSDBlendMode,
  LayerEffectInnerGlow,
  LayerEffectShadow,
  LayerEffectsInfo,
  LayerEffectsOuterGlow,
  UnitsValue
} from 'ag-psd'

import type { BlendMode, Effect, Fill, Stroke } from '@lawha/scene-graph'

import { psdColor, psdGradientFill } from './color'

/**
 * Photoshop layer styles as editable effects: drop and inner shadows, outer and inner glows (as
 * shadows without offset), strokes, and colour and gradient overlays as fills on top.
 */
export interface LayerStyle {
  effects: Effect[]
  strokes: Stroke[]
  /** Paints laid over the layer's own, top last. */
  overlays: Fill[]
}

const BLEND_MODES: Partial<Record<PSDBlendMode, BlendMode>> = {
  normal: 'NORMAL',
  multiply: 'MULTIPLY',
  screen: 'SCREEN',
  overlay: 'OVERLAY',
  darken: 'DARKEN',
  lighten: 'LIGHTEN',
  'color dodge': 'COLOR_DODGE',
  'color burn': 'COLOR_BURN',
  'hard light': 'HARD_LIGHT',
  'soft light': 'SOFT_LIGHT',
  difference: 'DIFFERENCE',
  exclusion: 'EXCLUSION',
  hue: 'HUE',
  saturation: 'SATURATION',
  color: 'COLOR',
  luminosity: 'LUMINOSITY',
  'linear burn': 'LINEAR_BURN',
  'linear dodge': 'LINEAR_DODGE'
}

export function psdBlendMode(mode: string | undefined): BlendMode | undefined {
  return mode ? BLEND_MODES[mode as PSDBlendMode] : undefined
}

/** A length in pixels; points and percentages are read as Photoshop shows them at 72 ppi. */
function px(value: UnitsValue | undefined): number {
  return value?.value ?? 0
}

const isOn = (effect: { enabled?: boolean; present?: boolean } | undefined) =>
  effect !== undefined && effect.enabled !== false && effect.present !== false

function shadow(
  type: Effect['type'],
  effect: LayerEffectShadow,
  globalAngle: number,
  scale: number
): Effect {
  const angle =
    ((effect.useGlobalLight ? globalAngle : (effect.angle ?? globalAngle)) * Math.PI) / 180
  const distance = px(effect.distance) * scale
  const size = px(effect.size) * scale
  const result: Effect = {
    type,
    color: { ...psdColor(effect.color), a: effect.opacity ?? 1 },
    // The light comes from `angle`, so the shadow falls away from it; y points down.
    offset: {
      x: Math.round(-Math.cos(angle) * distance * 100) / 100,
      y: Math.round(Math.sin(angle) * distance * 100) / 100
    },
    radius: size,
    spread: Math.round(((px(effect.choke) * size) / 100) * 100) / 100,
    visible: true
  }
  const blendMode = psdBlendMode(effect.blendMode)
  if (blendMode && blendMode !== 'NORMAL') result.blendMode = blendMode
  return result
}

function glow(
  type: Effect['type'],
  effect: LayerEffectsOuterGlow | LayerEffectInnerGlow,
  scale: number
): Effect {
  const gradientColor =
    effect.gradient?.type === 'solid' ? effect.gradient.colorStops[0]?.color : undefined
  const size = px(effect.size) * scale
  return {
    type,
    color: { ...psdColor(effect.color ?? gradientColor), a: effect.opacity ?? 1 },
    offset: { x: 0, y: 0 },
    radius: size,
    spread: Math.round(((px(effect.choke) * size) / 100) * 100) / 100,
    visible: true
  }
}

const STROKE_ALIGN = { inside: 'INSIDE', center: 'CENTER', outside: 'OUTSIDE' } as const

function strokes(info: LayerEffectsInfo, scale: number): Stroke[] {
  const out: Stroke[] = []
  for (const effect of info.stroke ?? []) {
    if (!isOn(effect)) continue
    const opacity = effect.opacity ?? 1
    const paint =
      effect.fillType === 'gradient' && effect.gradient
        ? psdGradientFill(effect.gradient, effect.gradient.style, effect.gradient.angle, opacity)
        : ({ type: 'SOLID', color: psdColor(effect.color), opacity, visible: true } as const)
    if (!paint) continue
    out.push({
      ...paint,
      weight: px(effect.size) * scale || 1,
      align: STROKE_ALIGN[effect.position ?? 'outside']
    })
  }
  return out
}

function overlays(info: LayerEffectsInfo): Fill[] {
  const out: Fill[] = []
  for (const effect of info.gradientOverlay ?? []) {
    if (!isOn(effect) || !effect.gradient) continue
    const fill = psdGradientFill(effect.gradient, effect.type, effect.angle, effect.opacity ?? 1)
    if (fill) out.push(fill)
  }
  // Photoshop draws the colour overlay over the gradient overlay.
  for (const effect of info.solidFill ?? []) {
    if (!isOn(effect)) continue
    const fill: Fill = {
      type: 'SOLID',
      color: psdColor(effect.color),
      opacity: effect.opacity ?? 1,
      visible: true
    }
    const blendMode = psdBlendMode(effect.blendMode)
    if (blendMode && blendMode !== 'NORMAL') fill.blendMode = blendMode
    out.push(fill)
  }
  return out
}

/** A layer's style, or nothing when it has none or its effects are turned off. */
export function layerStyle(info: LayerEffectsInfo | undefined, globalAngle: number): LayerStyle {
  if (!info || info.disabled) return { effects: [], strokes: [], overlays: [] }
  const scale = info.scale ?? 1
  const effects: Effect[] = []
  for (const effect of info.dropShadow ?? []) {
    if (isOn(effect)) effects.push(shadow('DROP_SHADOW', effect, globalAngle, scale))
  }
  if (isOn(info.outerGlow) && info.outerGlow)
    effects.push(glow('DROP_SHADOW', info.outerGlow, scale))
  for (const effect of info.innerShadow ?? []) {
    if (isOn(effect)) effects.push(shadow('INNER_SHADOW', effect, globalAngle, scale))
  }
  if (isOn(info.innerGlow) && info.innerGlow)
    effects.push(glow('INNER_SHADOW', info.innerGlow, scale))
  return { effects, strokes: strokes(info, scale), overlays: overlays(info) }
}
