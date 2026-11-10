import type { Color, Vector } from '@lawha/scene-graph/primitives'

import type { RGBAImage } from '#core/io/formats/raster'

import type { PixelMask } from './mask'

/** A round brush, in grid pixels: `size` is its diameter. */
export interface BrushTip {
  size: number
  /** 1 is a hard edge; 0 fades from the centre to the rim. */
  hardness: number
  /** How much one dab adds, 0–1; overlapping dabs within a stroke build up to it, no further. */
  opacity: number
}

/** How much of a dab reaches a pixel `distance` from its centre, 0–1. */
export function dabCoverage(distance: number, tip: BrushTip): number {
  const radius = tip.size / 2
  if (radius <= 0) return 0
  // A pixel-wide antialiased rim keeps even a hard brush smooth.
  const outer = radius + 0.5
  if (distance >= outer) return 0
  const solid = Math.max(0, radius * Math.min(1, tip.hardness) - 0.5)
  if (distance <= solid) return 1
  const t = (distance - solid) / (outer - solid)
  // Smoothstep from full to none between the hard core and the rim.
  return 1 - t * t * (3 - 2 * t)
}

/**
 * Centres of the dabs a stroke from `from` to `to` lays down, one every `spacing` pixels.
 * `carry` is how far past the last dab the previous segment ended; the returned `carry` goes into
 * the next segment, so dabs stay evenly spaced however the pointer samples.
 */
export function strokeDabs(
  from: Vector,
  to: Vector,
  spacing: number,
  carry: number
): { dabs: Vector[]; carry: number } {
  const length = Math.hypot(to.x - from.x, to.y - from.y)
  const step = Math.max(0.5, spacing)
  const dabs: Vector[] = []
  let at = step - carry
  while (at <= length) {
    const t = length === 0 ? 0 : at / length
    dabs.push({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t })
    at += step
  }
  return { dabs, carry: length - (at - step) }
}

/** The spacing between dabs Affinity and Photoshop default to: a quarter of the brush. */
export function dabSpacing(tip: BrushTip): number {
  return Math.max(0.5, tip.size * 0.25)
}

/**
 * Coverage reached by each pixel in one stroke, so overlapping dabs never stack past the brush's
 * opacity: a stroke is one even layer of paint, as in Affinity.
 */
export type StrokeCoverage = Float32Array

export function createStrokeCoverage(image: RGBAImage): StrokeCoverage {
  return new Float32Array(image.width * image.height)
}

/** The grid pixels a dab at `centre` can touch, clipped to the image. */
function dabBox(image: RGBAImage, centre: Vector, tip: BrushTip) {
  const reach = tip.size / 2 + 1
  return {
    x0: Math.max(0, Math.floor(centre.x - reach)),
    y0: Math.max(0, Math.floor(centre.y - reach)),
    x1: Math.min(image.width, Math.ceil(centre.x + reach)),
    y1: Math.min(image.height, Math.ceil(centre.y + reach))
  }
}

/**
 * Visits each pixel a dab reaches with how much more of the stroke it gets now: the dab's
 * coverage over what the stroke already gave it, limited by the selection.
 */
export function forDabPixels(
  image: RGBAImage,
  coverage: StrokeCoverage,
  centre: Vector,
  tip: BrushTip,
  mask: PixelMask | null,
  visit: (index: number, previous: number, next: number, x: number, y: number) => void
): void {
  const { x0, y0, x1, y1 } = dabBox(image, centre, tip)
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const index = y * image.width + x
      let amount = dabCoverage(Math.hypot(x + 0.5 - centre.x, y + 0.5 - centre.y), tip)
      if (amount <= 0) continue
      if (mask) amount *= mask.data[index] / 255
      const target = amount * tip.opacity
      const previous = coverage[index]
      if (target <= previous) continue
      coverage[index] = target
      visit(index, previous, target, x, y)
    }
  }
}

/** Blends `color` into one pixel by `amount`, source-over in unpremultiplied RGBA. */
export function blendPixel(data: Uint8Array, offset: number, color: Color, amount: number): void {
  const srcA = color.a * amount
  if (srcA <= 0) return
  const dstA = data[offset + 3] / 255
  const outA = srcA + dstA * (1 - srcA)
  if (outA <= 0) return
  const channel = (src: number, dst: number) =>
    Math.round((src * 255 * srcA + dst * dstA * (1 - srcA)) / outA)
  data[offset] = channel(color.r, data[offset])
  data[offset + 1] = channel(color.g, data[offset + 1])
  data[offset + 2] = channel(color.b, data[offset + 2])
  data[offset + 3] = Math.round(outA * 255)
}

/**
 * Paints one dab of `color`. The stroke's base, `before`, is what the pixel held when the stroke
 * began, so the stroke's coverage replaces what earlier dabs of it did rather than piling up.
 */
export function paintDab(
  image: RGBAImage,
  before: Uint8Array,
  coverage: StrokeCoverage,
  centre: Vector,
  tip: BrushTip,
  color: Color,
  mask: PixelMask | null = null
): void {
  forDabPixels(image, coverage, centre, tip, mask, (index, _previous, next) => {
    const offset = index * 4
    for (let c = 0; c < 4; c++) image.data[offset + c] = before[offset + c]
    blendPixel(image.data, offset, color, next)
  })
}

/** Erases one dab: alpha falls by the stroke's coverage, from what the pixel held at its start. */
export function eraseDab(
  image: RGBAImage,
  before: Uint8Array,
  coverage: StrokeCoverage,
  centre: Vector,
  tip: BrushTip,
  mask: PixelMask | null = null
): void {
  forDabPixels(image, coverage, centre, tip, mask, (index, _previous, next) => {
    image.data[index * 4 + 3] = Math.round(before[index * 4 + 3] * (1 - next))
  })
}
