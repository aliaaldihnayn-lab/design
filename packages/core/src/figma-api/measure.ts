import type { SkiaRenderer } from '#core/canvas'

import type { FigmaAPI } from './index'

const renderers = new WeakMap<FigmaAPI, SkiaRenderer>()

/** Records the renderer `api` measures with, which `setRenderer` sets; null forgets it. */
export function setMeasuringRenderer(api: FigmaAPI, renderer: SkiaRenderer | null): void {
  if (renderer) renderers.set(api, renderer)
  else renderers.delete(api)
}

/**
 * The renderer `api` measures geometry with, for Lawha tools whose operations need path
 * geometry (Shape Builder, warps, offsets) without putting a member on `figma`.
 */
export function measuringRenderer(api: FigmaAPI): SkiaRenderer | null {
  return renderers.get(api) ?? null
}
