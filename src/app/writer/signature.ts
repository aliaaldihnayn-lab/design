/**
 * Visual signatures for the document editor: drawn with a finger or mouse, typed in a script
 * font, or uploaded, each made into a transparent PNG trimmed to the ink and placed in the
 * document as an image the person can resize.
 */

import { coveredCellBounds } from '@lawha/scene-graph/geometry'
import type { Rect } from '@lawha/scene-graph/primitives'

export type InkBounds = Rect

/** The box around every pixel with ink (alpha above a threshold), or null for an empty canvas. */
export function inkBounds(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  threshold = 8
): InkBounds | null {
  return coveredCellBounds(width, height, (index) => data[index * 4 + 3] > threshold)
}

/** The size a signature is placed at: as drawn, no wider than `maxWidth` CSS pixels. */
export function placedSize(
  width: number,
  height: number,
  maxWidth = 220
): { width: number; height: number } {
  const scale = Math.min(1, maxWidth / Math.max(width, 1))
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

/** Fonts offered for a typed signature: Latin and Arabic script faces. */
export const SIGNATURE_FONTS = ['Great Vibes', 'Dancing Script', 'Aref Ruqaa', 'Reem Kufi'] as const

const PADDING = 8

/** Copies the inked part of a canvas, with a little room around it, as a PNG data URL. */
export function trimmedPNG(
  canvas: HTMLCanvasElement
): { src: string; width: number; height: number } | null {
  const context = canvas.getContext('2d')
  if (!context) return null
  const image = context.getImageData(0, 0, canvas.width, canvas.height)
  const bounds = inkBounds(image.data, canvas.width, canvas.height)
  if (!bounds) return null
  const out = document.createElement('canvas')
  out.width = bounds.width + PADDING * 2
  out.height = bounds.height + PADDING * 2
  out
    .getContext('2d')
    ?.drawImage(
      canvas,
      bounds.x,
      bounds.y,
      bounds.width,
      bounds.height,
      PADDING,
      PADDING,
      bounds.width,
      bounds.height
    )
  return { src: out.toDataURL('image/png'), width: out.width, height: out.height }
}

/** Renders typed text in a script font onto a canvas, waiting for the font first. */
export async function typedSignature(
  text: string,
  font: string,
  color: string
): Promise<{ src: string; width: number; height: number } | null> {
  const size = 72
  const spec = `${size}px "${font}"`
  await document.fonts.load(spec, text).catch(() => [])
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) return null
  context.font = spec
  const width = Math.ceil(context.measureText(text).width) + size
  canvas.width = width
  canvas.height = size * 2
  context.font = spec
  context.fillStyle = color
  context.textBaseline = 'middle'
  context.direction = /[؀-ۿ]/u.test(text) ? 'rtl' : 'ltr'
  context.textAlign = 'center'
  context.fillText(text, width / 2, size)
  return trimmedPNG(canvas)
}

/** Any image data URL as PNG Base64, as a signature is stored. */
export async function pngBase64(src: string): Promise<string> {
  const image = new Image()
  image.src = src
  await image.decode()
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  canvas.getContext('2d')?.drawImage(image, 0, 0)
  return canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '')
}
