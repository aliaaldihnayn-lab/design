import type { RGBAImage } from '#core/io/formats/raster'

export function blankImage(width: number, height: number): RGBAImage {
  return { width, height, data: new Uint8Array(width * height * 4) }
}

export function cloneImage(image: RGBAImage): RGBAImage {
  return { width: image.width, height: image.height, data: image.data.slice() }
}

/** How an image sits in the grid: covering it (Fill), inside it (Fit), or stretched to it. */
export type ImagePlacement = 'FILL' | 'FIT' | 'STRETCH'

/**
 * `source` drawn into a `width` × `height` grid as its fill's scale mode places it, sampled
 * bilinearly; what it leaves uncovered is transparent.
 */
export function placeImage(
  source: RGBAImage,
  width: number,
  height: number,
  placement: ImagePlacement
): RGBAImage {
  const out = blankImage(width, height)
  if (source.width === 0 || source.height === 0) return out
  let scaleX = width / source.width
  let scaleY = height / source.height
  if (placement !== 'STRETCH') {
    const scale = placement === 'FILL' ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY)
    scaleX = scale
    scaleY = scale
  }
  const offsetX = (width - source.width * scaleX) / 2
  const offsetY = (height - source.height * scaleY) / 2
  const src = source.data
  const sw = source.width
  const sh = source.height
  for (let y = 0; y < height; y++) {
    const sy = (y + 0.5 - offsetY) / scaleY - 0.5
    if (sy < -0.5 || sy > sh - 0.5) continue
    const y0 = Math.max(0, Math.min(sh - 1, Math.floor(sy)))
    const y1 = Math.min(sh - 1, y0 + 1)
    const fy = Math.max(0, Math.min(1, sy - y0))
    for (let x = 0; x < width; x++) {
      const sx = (x + 0.5 - offsetX) / scaleX - 0.5
      if (sx < -0.5 || sx > sw - 0.5) continue
      const x0 = Math.max(0, Math.min(sw - 1, Math.floor(sx)))
      const x1 = Math.min(sw - 1, x0 + 1)
      const fx = Math.max(0, Math.min(1, sx - x0))
      const o = (y * width + x) * 4
      const a = (y0 * sw + x0) * 4
      const b = (y0 * sw + x1) * 4
      const c = (y1 * sw + x0) * 4
      const d = (y1 * sw + x1) * 4
      for (let k = 0; k < 4; k++) {
        const top = src[a + k] * (1 - fx) + src[b + k] * fx
        const bottom = src[c + k] * (1 - fx) + src[d + k] * fx
        out.data[o + k] = Math.round(top * (1 - fy) + bottom * fy)
      }
    }
  }
  return out
}

/** `top` drawn over `bottom` (source-over), both the same size; a new image. */
export function compositeOver(bottom: RGBAImage, top: RGBAImage): RGBAImage {
  const out = cloneImage(bottom)
  const d = out.data
  const s = top.data
  for (let o = 0; o < d.length; o += 4) {
    const srcA = s[o + 3] / 255
    if (srcA === 0) continue
    const dstA = d[o + 3] / 255
    const outA = srcA + dstA * (1 - srcA)
    for (let k = 0; k < 3; k++) {
      d[o + k] = Math.round((s[o + k] * srcA + d[o + k] * dstA * (1 - srcA)) / outA)
    }
    d[o + 3] = Math.round(outA * 255)
  }
  return out
}

/** Whether no pixel of the image is visible. */
export function isTransparent(image: RGBAImage): boolean {
  for (let o = 3; o < image.data.length; o += 4) if (image.data[o] !== 0) return false
  return true
}
