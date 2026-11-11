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
