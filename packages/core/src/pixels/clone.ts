import type { Vector } from '@lawha/scene-graph/primitives'

import type { RGBAImage } from '#core/io/formats/raster'

import { blendPixel, forDabPixels, type BrushTip, type StrokeCoverage } from './brush'
import type { PixelMask } from './mask'

/** Where a clone or healing stroke reads from, relative to where it paints. */
export interface CloneSampling {
  /** What the layer showed when the stroke began, which the stroke copies from. */
  source: RGBAImage
  /** Added to a painted pixel's position to find the pixel it copies. */
  offset: Vector
}

function sourceIndex(source: RGBAImage, x: number, y: number): number {
  const sx = Math.round(x)
  const sy = Math.round(y)
  if (sx < 0 || sy < 0 || sx >= source.width || sy >= source.height) return -1
  return (sy * source.width + sx) * 4
}

/** Writes pixel `index` as the stroke's base with `rgba` blended over it by `amount`. */
function writeOver(
  image: RGBAImage,
  before: Uint8Array,
  index: number,
  rgba: ArrayLike<number>,
  amount: number
) {
  const offset = index * 4
  for (let c = 0; c < 4; c++) image.data[offset + c] = before[offset + c]
  blendPixel(
    image.data,
    offset,
    { r: rgba[0] / 255, g: rgba[1] / 255, b: rgba[2] / 255, a: rgba[3] / 255 },
    amount
  )
}

/**
 * One dab of the clone stamp: the pixels at `offset` from the dab, as the layer showed them when
 * the stroke began, painted over the dab's area with the brush's falloff.
 */
export function cloneDab(
  image: RGBAImage,
  before: Uint8Array,
  coverage: StrokeCoverage,
  centre: Vector,
  tip: BrushTip,
  sampling: CloneSampling,
  mask: PixelMask | null = null
): void {
  const { source, offset } = sampling
  forDabPixels(image, coverage, centre, tip, mask, (index, _previous, next, x, y) => {
    const from = sourceIndex(source, x + offset.x, y + offset.y)
    if (from < 0) return
    writeOver(image, before, index, source.data.subarray(from, from + 4), next)
  })
}

/** The average colour of the pixels within `radius` of a point, alpha-weighted, 0–255. */
function patchMean(image: RGBAImage, centre: Vector, radius: number): number[] | null {
  const sum = [0, 0, 0]
  let weight = 0
  const reach = Math.ceil(radius)
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      if (dx * dx + dy * dy > radius * radius) continue
      const at = sourceIndex(image, centre.x + dx, centre.y + dy)
      if (at < 0) continue
      const alpha = image.data[at + 3] / 255
      for (let c = 0; c < 3; c++) sum[c] += image.data[at + c] * alpha
      weight += alpha
    }
  }
  return weight > 0 ? sum.map((value) => value / weight) : null
}

/**
 * One dab of the healing brush: the clone stamp's texture, shifted in colour so its average
 * matches the average around the dab's own spot, so a blemish takes clean skin's detail in the
 * skin's own tone, as Affinity's healing brush blends a patch into its surroundings.
 */
export function healDab(
  image: RGBAImage,
  before: Uint8Array,
  coverage: StrokeCoverage,
  centre: Vector,
  tip: BrushTip,
  sampling: CloneSampling,
  mask: PixelMask | null = null
): void {
  const { source, offset } = sampling
  // The surroundings are read a little wider than the brush, so the blemish under it counts less.
  const radius = Math.max(1, tip.size * 0.75)
  const target = patchMean(source, centre, radius)
  const from = patchMean(source, { x: centre.x + offset.x, y: centre.y + offset.y }, radius)
  const shift = target && from ? target.map((value, c) => value - from[c]) : [0, 0, 0]
  forDabPixels(image, coverage, centre, tip, mask, (index, _previous, next, x, y) => {
    const at = sourceIndex(source, x + offset.x, y + offset.y)
    if (at < 0) return
    const rgba = [
      Math.max(0, Math.min(255, source.data[at] + shift[0])),
      Math.max(0, Math.min(255, source.data[at + 1] + shift[1])),
      Math.max(0, Math.min(255, source.data[at + 2] + shift[2])),
      source.data[at + 3]
    ]
    writeOver(image, before, index, rgba, next)
  })
}
