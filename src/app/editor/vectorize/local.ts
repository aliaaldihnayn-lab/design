import type { CanvasKit } from 'canvaskit-wasm'

import {
  traceImage,
  tracePixelsFromImage,
  tracePresetSettings,
  traceToSVG,
  type TracePreset
} from '@lawha/core/vector'

/**
 * What the on-device tracer reads an image with, as Illustrator's Image Trace panel sets it: a
 * preset, the most colours a colour preset keeps, and the luminance a black and white preset
 * splits at.
 */
export interface LocalTraceOptions {
  preset: TracePreset
  colors: number
  threshold: number
}

export const DEFAULT_LOCAL_TRACE_OPTIONS: LocalTraceOptions = {
  preset: 'logo',
  colors: 6,
  threshold: 128
}

/** A trace as SVG, and how many colours it drew, for the importer and the settings preview. */
export function traceImageBytes(
  imageBytes: Uint8Array,
  ck: CanvasKit,
  options: LocalTraceOptions = DEFAULT_LOCAL_TRACE_OPTIONS
): { svg: string; colors: number } {
  const { maxSide, options: settings } = tracePresetSettings(options.preset, {
    colors: options.colors,
    threshold: options.threshold
  })
  const pixels = tracePixelsFromImage(ck, imageBytes, maxSide)
  if (!pixels) throw new Error('The image could not be decoded')
  const traced = traceImage(pixels, settings)
  if (traced.layers.length === 0) throw new Error('The trace found no shapes')
  return { svg: traceToSVG(traced), colors: traced.layers.length }
}

/**
 * The offline vectorize provider: Image Trace on this device with CanvasKit decoding the image,
 * so it needs no network or API key. Like the cloud providers it answers with SVG, which the
 * caller imports as layers.
 */
export const LOCAL_TRACE_PROVIDER = {
  id: 'local',
  name: 'Image Trace',
  offline: true,
  vectorize(
    imageBytes: Uint8Array,
    ck: CanvasKit,
    options: LocalTraceOptions = DEFAULT_LOCAL_TRACE_OPTIONS
  ): string {
    return traceImageBytes(imageBytes, ck, options).svg
  }
} as const
