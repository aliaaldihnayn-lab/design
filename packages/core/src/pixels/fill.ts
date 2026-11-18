import type { Color } from '@lawha/scene-graph/primitives'

import { TRANSPARENT } from '#core/constants'
import type { RGBAImage } from '#core/io/formats/raster'

import { blendPixel } from './brush'
import { createMask, type PixelMask } from './mask'

/**
 * How different two pixels look, 0 (the same) to 1: the largest channel difference, alpha
 * included, which is how Photoshop's and Affinity's tolerance reads.
 */
function difference(data: Uint8Array, a: number, b: number): number {
  return (
    Math.max(
      Math.abs(data[a] - data[b]),
      Math.abs(data[a + 1] - data[b + 1]),
      Math.abs(data[a + 2] - data[b + 2]),
      Math.abs(data[a + 3] - data[b + 3])
    ) / 255
  )
}

/**
 * The pixels like the one at (`x`, `y`) within `tolerance` (0–1): those connected to it when
 * `contiguous`, as the magic wand and the fill bucket pick, or every such pixel in the image.
 */
export function selectSimilar(
  image: RGBAImage,
  x: number,
  y: number,
  tolerance: number,
  contiguous = true
): PixelMask {
  const { width, height, data } = image
  const mask = createMask(width, height)
  const px = Math.floor(x)
  const py = Math.floor(y)
  if (px < 0 || py < 0 || px >= width || py >= height) return mask
  const seed = (py * width + px) * 4
  const similar = (index: number) => difference(data, seed, index * 4) <= tolerance
  if (!contiguous) {
    for (let i = 0; i < width * height; i++) if (similar(i)) mask.data[i] = 255
    return mask
  }
  floodFrom(mask, py * width + px, similar)
  return mask
}

/** Marks every pixel connected to `seed` that is `similar`, by scanline flood fill. */
function floodFrom(mask: PixelMask, seed: number, similar: (index: number) => boolean) {
  const { width, height } = mask
  // A stack of scanline seeds, so a large region never grows the call stack.
  const stack: number[] = [seed]
  while (stack.length > 0) {
    const start = stack.pop() ?? 0
    if (mask.data[start]) continue
    const row = Math.floor(start / width)
    let left = start
    while (left % width > 0 && !mask.data[left - 1] && similar(left - 1)) left--
    let right = start
    while (right % width < width - 1 && !mask.data[right + 1] && similar(right + 1)) right++
    for (let i = left; i <= right; i++) {
      mask.data[i] = 255
      if (row > 0 && !mask.data[i - width] && similar(i - width)) stack.push(i - width)
      if (row < height - 1 && !mask.data[i + width] && similar(i + width)) stack.push(i + width)
    }
  }
}

/** Paints `color` at `opacity` over every pixel `region` covers, as far as it covers it. */
export function fillRegion(image: RGBAImage, region: PixelMask, color: Color, opacity = 1): number {
  let filled = 0
  for (let i = 0; i < region.data.length; i++) {
    const amount = region.data[i] / 255
    if (amount <= 0) continue
    blendPixel(image.data, i * 4, color, amount * opacity)
    filled++
  }
  return filled
}

/** The colour of the pixel at (`x`, `y`), or null outside the image. */
export function pixelColor(image: RGBAImage, x: number, y: number): Color | null {
  const px = Math.floor(x)
  const py = Math.floor(y)
  if (px < 0 || py < 0 || px >= image.width || py >= image.height) return null
  const o = (py * image.width + px) * 4
  const d = image.data
  return { r: d[o] / 255, g: d[o + 1] / 255, b: d[o + 2] / 255, a: d[o + 3] / 255 }
}

/** The average colour of the pixels within `radius` of (`x`, `y`), alpha-weighted. */
export function averageColor(image: RGBAImage, x: number, y: number, radius: number): Color | null {
  let r = 0
  let g = 0
  let b = 0
  let a = 0
  let count = 0
  const reach = Math.max(0, Math.floor(radius))
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      if (dx * dx + dy * dy > reach * reach) continue
      const color = pixelColor(image, x + dx, y + dy)
      if (!color) continue
      r += color.r * color.a
      g += color.g * color.a
      b += color.b * color.a
      a += color.a
      count++
    }
  }
  if (count === 0) return null
  if (a === 0) return { ...TRANSPARENT }
  return { r: r / a, g: g / a, b: b / a, a: a / count }
}
