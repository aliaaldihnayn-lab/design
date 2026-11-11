import type {
  Color as PSDColor,
  EffectNoiseGradient,
  EffectSolidGradient,
  ExtraGradientInfo,
  GradientStyle
} from 'ag-psd'
import { converter } from 'culori'
import { clamp } from 'es-toolkit'

import type { Fill } from '@lawha/scene-graph'
import { BLACK } from '@lawha/scene-graph/constants'
import { ellipticalGradientTransform, linearGradientTransform } from '@lawha/scene-graph/gradient'
import type { Color } from '@lawha/scene-graph/primitives'

const toRGB = converter('rgb')

const unit = (value: number) => clamp(value, 0, 1)

function fromCulori(color: { r: number; g: number; b: number }): Color {
  return { r: unit(color.r), g: unit(color.g), b: unit(color.b), a: 1 }
}

/** A Photoshop colour (RGB 0–255, float RGB, HSB, CMYK, grey, Lab) as a scene colour. */
export function psdColor(color: PSDColor | undefined): Color {
  if (!color) return { ...BLACK }
  if ('fr' in color) return { r: unit(color.fr), g: unit(color.fg), b: unit(color.fb), a: 1 }
  if ('r' in color)
    return { r: unit(color.r / 255), g: unit(color.g / 255), b: unit(color.b / 255), a: 1 }
  if ('h' in color) return fromCulori(toRGB({ mode: 'hsv', h: color.h, s: color.s, v: color.b }))
  if ('c' in color) {
    const k = color.k / 255
    const ink = (v: number) => unit((1 - v / 255) * (1 - k))
    return { r: ink(color.c), g: ink(color.m), b: ink(color.y), a: 1 }
  }
  if ('l' in color) {
    return fromCulori(toRGB({ mode: 'lab', l: color.l * 100, a: color.a * 128, b: color.b * 128 }))
  }
  const grey = unit(1 - color.k / 255)
  return { r: grey, g: grey, b: grey, a: 1 }
}

type PSDGradient = (EffectSolidGradient | EffectNoiseGradient) & ExtraGradientInfo

/** The opacity a gradient's opacity stops give at `location`, between the nearest two. */
function opacityAt(gradient: EffectSolidGradient, location: number): number {
  const stops = [...gradient.opacityStops].sort((a, b) => a.location - b.location)
  const after = stops.findIndex((stop) => stop.location >= location)
  if (after === -1) return stops.at(-1)?.opacity ?? 1
  if (after === 0) return stops[0].opacity
  const a = stops[after - 1]
  const b = stops[after]
  const t = b.location === a.location ? 0 : (location - a.location) / (b.location - a.location)
  return a.opacity + (b.opacity - a.opacity) * t
}

/**
 * A Photoshop gradient (fill layer, overlay, or stroke) as a gradient paint over the layer's box.
 * Angle and reverse are kept; reflected, angle and diamond styles become the nearest kind.
 */
export function psdGradientFill(
  gradient: PSDGradient,
  style: GradientStyle | undefined,
  angleDegrees: number | undefined,
  opacity: number
): Fill | null {
  if (gradient.type !== 'solid' || gradient.colorStops.length === 0) return null
  const stops = gradient.colorStops
    .map((stop) => ({
      position: gradient.reverse ? 1 - stop.location : stop.location,
      color: { ...psdColor(stop.color), a: unit(opacityAt(gradient, stop.location)) }
    }))
    .sort((a, b) => a.position - b.position)
  const base = { color: { ...stops[0].color }, gradientStops: stops, opacity, visible: true }
  if (style === 'radial' || style === 'diamond') {
    return {
      ...base,
      type: style === 'radial' ? 'GRADIENT_RADIAL' : 'GRADIENT_DIAMOND',
      gradientTransform: ellipticalGradientTransform(
        { x: 0.5, y: 0.5 },
        { x: 1, y: 0.5 },
        { x: 0.5, y: 1 }
      )
    }
  }
  if (style === 'angle') {
    return {
      ...base,
      type: 'GRADIENT_ANGULAR',
      gradientTransform: ellipticalGradientTransform(
        { x: 0.5, y: 0.5 },
        { x: 1, y: 0.5 },
        { x: 0.5, y: 1 }
      )
    }
  }
  // Photoshop measures the angle counter-clockwise from the right, y up.
  const radians = ((angleDegrees ?? 90) * Math.PI) / 180
  const dx = Math.cos(radians) / 2
  const dy = -Math.sin(radians) / 2
  return {
    ...base,
    type: 'GRADIENT_LINEAR',
    gradientTransform: linearGradientTransform(
      { x: 0.5 - dx, y: 0.5 - dy },
      { x: 0.5 + dx, y: 0.5 + dy }
    )
  }
}
