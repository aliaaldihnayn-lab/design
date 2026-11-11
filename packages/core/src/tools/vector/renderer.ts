import type { SkiaRenderer } from '#core/canvas/renderer'
import type { FigmaAPI } from '#core/figma-api'
import { measuringRenderer } from '#core/figma-api/measure'

/** Runs `run` with the host's path-measuring renderer, or reports `unsupported` when it has none. */
export function withRenderer<T>(
  figma: FigmaAPI,
  unsupported: string,
  run: (renderer: SkiaRenderer) => T
): T | { error: string } {
  const renderer = measuringRenderer(figma)
  return renderer ? run(renderer) : { error: unsupported }
}
