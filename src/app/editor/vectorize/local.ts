import type { CanvasKit } from 'canvaskit-wasm'

import { traceSettings, type TraceDetail } from '@lawha/core/tools'
import { traceImage, tracePixelsFromImage, traceToSVG } from '@lawha/core/vector'

/** What the on-device tracer reads an image with: its detail level and most colours. */
export interface LocalTraceOptions {
  detail: TraceDetail
  colors: number
}

export const DEFAULT_LOCAL_TRACE_OPTIONS: LocalTraceOptions = { detail: 'medium', colors: 8 }

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
    const { maxSide, options: settings } = traceSettings(options.detail, options.colors)
    const pixels = tracePixelsFromImage(ck, imageBytes, maxSide)
    if (!pixels) throw new Error('The image could not be decoded')
    const traced = traceImage(pixels, settings)
    if (traced.layers.length === 0) throw new Error('The trace found no shapes')
    return traceToSVG(traced)
  }
} as const
