import { traceMask } from './contours'
import { fitLoopPath } from './fit'
import { despeckle, quantize, type RGB, type TracePixels } from './quantize'

export type { TracePixels } from './quantize'

/** How Image Trace reads an image, as Illustrator's Image Trace panel sets it. */
export interface TraceOptions {
  /** Most colours the trace keeps, 2–64. */
  colors: number
  /** Patches smaller than this many pixels are absorbed by their neighbours. */
  noise: number
  /** How closely paths follow the pixels, in pixels: lower keeps more detail. */
  tolerance: number
  /** Turns sharper than this, in degrees, stay corners. */
  cornerAngle: number
  /** Traces each colour over the ones after it, so the shapes leave no hairline gaps. */
  stacked: boolean
}

export const DEFAULT_TRACE_OPTIONS: TraceOptions = {
  colors: 8,
  noise: 8,
  tolerance: 1,
  cornerAngle: 70,
  stacked: true
}

/** The traced layers, largest first: each colour's area as SVG path data in pixels. */
export interface TraceResult {
  width: number
  height: number
  layers: { color: RGB; area: number; d: string }[]
}

const hex = ([r, g, b]: RGB) =>
  `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`

/**
 * Illustrator's Image Trace, on the device: the image is reduced to a few colours, specks are
 * absorbed, each colour's area is outlined along the pixel edges, and the outlines are smoothed
 * into cubic curves with sharp corners kept. Colours are stacked largest first.
 */
export function traceImage(pixels: TracePixels, options: Partial<TraceOptions> = {}): TraceResult {
  const settings = { ...DEFAULT_TRACE_OPTIONS, ...options }
  const { width, height } = pixels
  const colors = Math.max(2, Math.min(64, Math.round(settings.colors)))
  const { palette, labels } = quantize(pixels, colors)
  despeckle(labels, width, height, Math.max(0, Math.round(settings.noise)))
  const areas = palette.map(() => 0)
  for (const label of labels) if (label >= 0) areas[label]++
  const order = palette.map((_, index) => index).filter((index) => areas[index] > 0)
  order.sort((a, b) => areas[b] - areas[a])
  const rank = new Int16Array(palette.length).fill(-1)
  for (const [position, index] of order.entries()) rank[index] = position
  const fit = {
    tolerance: Math.max(0.1, settings.tolerance),
    cornerAngle: (Math.max(1, Math.min(179, settings.cornerAngle)) * Math.PI) / 180,
    width,
    height
  }
  const mask = new Uint8Array(labels.length)
  const layers: TraceResult['layers'] = []
  for (const [position, index] of order.entries()) {
    for (let i = 0; i < labels.length; i++) {
      const label = labels[i]
      mask[i] = label >= 0 && (settings.stacked ? rank[label] >= position : label === index) ? 1 : 0
    }
    const d = traceMask(mask, width, height)
      .map((loop) => fitLoopPath(loop, fit))
      .filter((part) => part.length > 0)
      .join('')
    if (d) layers.push({ color: palette[index], area: areas[index], d })
  }
  return { width, height, layers }
}

/** A trace as an SVG document, each colour one even-odd path, for the vector importer. */
export function traceToSVG(result: TraceResult): string {
  const paths = result.layers
    .map(({ color, d }) => `<path fill="${hex(color)}" fill-rule="evenodd" d="${d}"/>`)
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${result.width}" height="${result.height}" viewBox="0 0 ${result.width} ${result.height}">${paths}</svg>`
}
