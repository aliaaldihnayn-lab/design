import type { CanvasKit } from 'canvaskit-wasm'

import type { TracePixels } from './quantize'

/**
 * Decodes an encoded image and averages it down so its longer side is at most `maxSide` pixels,
 * which bounds the trace's time and the number of paths; null when it cannot be decoded.
 */
export function tracePixelsFromImage(
  ck: CanvasKit,
  bytes: Uint8Array,
  maxSide: number
): TracePixels | null {
  const image = ck.MakeImageFromEncoded(bytes)
  if (!image) return null
  try {
    const width = image.width()
    const height = image.height()
    if (width <= 0 || height <= 0) return null
    const full = image.readPixels(0, 0, {
      width,
      height,
      colorType: ck.ColorType.RGBA_8888,
      alphaType: ck.AlphaType.Unpremul,
      colorSpace: ck.ColorSpace.SRGB
    })
    if (!(full instanceof Uint8Array)) return null
    return downsample({ width, height, data: full }, maxSide)
  } finally {
    image.delete()
  }
}

/** Box-filters pixels so the longer side is at most `maxSide`; smaller images are kept. */
export function downsample(pixels: TracePixels, maxSide: number): TracePixels {
  const scale = Math.min(1, maxSide / Math.max(pixels.width, pixels.height))
  if (scale >= 1) return pixels
  const width = Math.max(1, Math.round(pixels.width * scale))
  const height = Math.max(1, Math.round(pixels.height * scale))
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor((y / height) * pixels.height)
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) / height) * pixels.height))
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor((x / width) * pixels.width)
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) / width) * pixels.width))
      const sum = [0, 0, 0, 0]
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const at = (sy * pixels.width + sx) * 4
          for (let c = 0; c < 4; c++) sum[c] += pixels.data[at + c]
        }
      }
      const count = (y1 - y0) * (x1 - x0)
      for (let c = 0; c < 4; c++) data[(y * width + x) * 4 + c] = Math.round(sum[c] / count)
    }
  }
  return { width, height, data }
}
