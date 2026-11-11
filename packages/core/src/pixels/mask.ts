import { coveredCellBounds } from '@lawha/scene-graph/geometry'
import type { Rect } from '@lawha/scene-graph/primitives'

import type { ByteGrid } from '#core/io/formats/raster/pixels'

/**
 * How much of each pixel a selection or layer mask covers, 0 (none) to 255 (all), row-major over
 * a `width` × `height` grid with no padding.
 */
export type PixelMask = ByteGrid

/** How a new selection joins the one there is, as Affinity's and Photoshop's selection modes do. */
export type SelectionMode = 'replace' | 'add' | 'subtract' | 'intersect'

export function createMask(width: number, height: number, value = 0): PixelMask {
  const data = new Uint8Array(width * height)
  if (value) data.fill(value)
  return { width, height, data }
}

/** Every pixel whose centre lies in `rect`, a rectangle in grid pixels. */
export function rectMask(width: number, height: number, rect: Rect): PixelMask {
  const mask = createMask(width, height)
  const x0 = Math.max(0, Math.round(rect.x))
  const y0 = Math.max(0, Math.round(rect.y))
  const x1 = Math.min(width, Math.round(rect.x + rect.width))
  const y1 = Math.min(height, Math.round(rect.y + rect.height))
  for (let y = y0; y < y1; y++) mask.data.fill(255, y * width + x0, y * width + Math.max(x0, x1))
  return mask
}

/** The ellipse inscribed in `rect`, its edge antialiased over one pixel. */
export function ellipseMask(width: number, height: number, rect: Rect): PixelMask {
  const mask = createMask(width, height)
  const rx = rect.width / 2
  const ry = rect.height / 2
  if (rx <= 0 || ry <= 0) return mask
  const cx = rect.x + rx
  const cy = rect.y + ry
  const y0 = Math.max(0, Math.floor(rect.y))
  const y1 = Math.min(height, Math.ceil(rect.y + rect.height))
  const x0 = Math.max(0, Math.floor(rect.x))
  const x1 = Math.min(width, Math.ceil(rect.x + rect.width))
  const scale = Math.min(rx, ry)
  for (let y = y0; y < y1; y++) {
    const dy = (y + 0.5 - cy) / ry
    for (let x = x0; x < x1; x++) {
      const dx = (x + 0.5 - cx) / rx
      // Distance outside the edge in pixels, roughly: positive outside, negative inside.
      const edge = (Math.hypot(dx, dy) - 1) * scale
      const cover = Math.max(0, Math.min(1, 0.5 - edge))
      mask.data[y * width + x] = Math.round(cover * 255)
    }
  }
  return mask
}

/** `next` joined to `current` by `mode`; a missing `current` is an empty selection. */
export function combineMasks(
  current: PixelMask | null,
  next: PixelMask,
  mode: SelectionMode
): PixelMask {
  if (mode === 'replace' || !current) {
    return mode === 'subtract' || mode === 'intersect' ? createMask(next.width, next.height) : next
  }
  if (current.width !== next.width || current.height !== next.height) return next
  const out = createMask(next.width, next.height)
  const a = current.data
  const b = next.data
  for (let i = 0; i < out.data.length; i++) {
    if (mode === 'add') out.data[i] = Math.max(a[i], b[i])
    else if (mode === 'subtract') out.data[i] = Math.max(0, a[i] - b[i])
    else out.data[i] = Math.min(a[i], b[i])
  }
  return out
}

export function invertMask(mask: PixelMask): PixelMask {
  const out = createMask(mask.width, mask.height)
  for (let i = 0; i < out.data.length; i++) out.data[i] = 255 - mask.data[i]
  return out
}

/** One box blur pass of `radius` along rows (`horizontal`) or columns, into `out`. */
function boxBlurPass(
  src: Float32Array,
  out: Float32Array,
  width: number,
  height: number,
  radius: number,
  horizontal: boolean
) {
  const lines = horizontal ? height : width
  const length = horizontal ? width : height
  const stride = horizontal ? 1 : width
  const size = radius * 2 + 1
  for (let line = 0; line < lines; line++) {
    const start = horizontal ? line * width : line
    let sum = 0
    // The edge pixel repeats beyond the grid, so a feathered selection at the border stays full.
    for (let k = -radius; k <= radius; k++) {
      sum += src[start + Math.min(length - 1, Math.max(0, k)) * stride]
    }
    for (let i = 0; i < length; i++) {
      out[start + i * stride] = sum / size
      const add = Math.min(length - 1, i + radius + 1)
      const drop = Math.max(0, i - radius)
      sum += src[start + add * stride] - src[start + drop * stride]
    }
  }
}

/**
 * The mask with its edges softened over about `radius` pixels: three box blurs in each
 * direction, which together approximate a Gaussian blur of that radius.
 */
export function featherMask(mask: PixelMask, radius: number): PixelMask {
  const { width, height } = mask
  if (radius < 0.5 || width === 0 || height === 0) return mask
  const box = Math.max(1, Math.round(radius / 3))
  let a = Float32Array.from(mask.data)
  let b = new Float32Array(a.length)
  for (let pass = 0; pass < 3; pass++) {
    boxBlurPass(a, b, width, height, box, true)
    ;[a, b] = [b, a]
    boxBlurPass(a, b, width, height, box, false)
    ;[a, b] = [b, a]
  }
  const out = createMask(width, height)
  for (let i = 0; i < a.length; i++) out.data[i] = Math.round(a[i])
  return out
}

/** The smallest rectangle of grid pixels holding every selected pixel, or null when none is. */
export function maskBounds(mask: PixelMask): Rect | null {
  const { width, height, data } = mask
  return coveredCellBounds(width, height, (index) => data[index] !== 0)
}

/** Which way an edge between two pixels faces: 0 when both are on the same side of it. */
function edgeSide(before: boolean, after: boolean): number {
  if (before === after) return 0
  return before ? 1 : -1
}

/**
 * The selection's outline as line segments `x1, y1, x2, y2` along pixel edges in grid
 * coordinates: every edge between a pixel at least half selected and one that is not. Runs along
 * a row or column are merged, so a rectangle is four segments.
 */
export function maskOutline(mask: PixelMask): Float32Array {
  const { width, height, data } = mask
  const inside = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < width && y < height && data[y * width + x] >= 128
  const segments: number[] = []
  // Horizontal edges, above each row y (between y - 1 and y).
  for (let y = 0; y <= height; y++) {
    let start = -1
    let side = 0
    for (let x = 0; x <= width; x++) {
      const a = x < width && inside(x, y - 1)
      const b = x < width && inside(x, y)
      const edge = edgeSide(a, b)
      if (edge !== side) {
        if (side !== 0) segments.push(start, y, x, y)
        start = x
        side = edge
      }
    }
  }
  // Vertical edges, left of each column x.
  for (let x = 0; x <= width; x++) {
    let start = -1
    let side = 0
    for (let y = 0; y <= height; y++) {
      const a = y < height && inside(x - 1, y)
      const b = y < height && inside(x, y)
      const edge = edgeSide(a, b)
      if (edge !== side) {
        if (side !== 0) segments.push(x, start, x, y)
        start = y
        side = edge
      }
    }
  }
  return Float32Array.from(segments)
}

/** A copy of `mask` resampled to `width` × `height` by nearest pixel. */
export function resampleMask(mask: PixelMask, width: number, height: number): PixelMask {
  if (mask.width === width && mask.height === height) return mask
  const out = createMask(width, height)
  for (let y = 0; y < height; y++) {
    const sy = Math.min(mask.height - 1, Math.floor(((y + 0.5) * mask.height) / height))
    for (let x = 0; x < width; x++) {
      const sx = Math.min(mask.width - 1, Math.floor(((x + 0.5) * mask.width) / width))
      out.data[y * width + x] = mask.data[sy * mask.width + sx]
    }
  }
  return out
}
