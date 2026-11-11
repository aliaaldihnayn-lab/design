import { traceMask } from '#core/vector/vectorize/trace/contours'
import { fitLoopPath } from '#core/vector/vectorize/trace/fit'

/** Pixels at least half opaque are inside the outline. */
const INSIDE_ALPHA = 128
/** Larger layers keep their styles on their box: tracing them would take too long. */
const MAX_TRACED_PIXELS = 4096 * 4096

/**
 * The outline of what a pixel layer draws, as even-odd SVG path data in its own pixels: the
 * edges of its opaque pixels, smoothed into curves within half a pixel. Null when it draws
 * nothing or is too large to trace.
 */
export function pixelOutline(rgba: Uint8Array, width: number, height: number): string | null {
  if (width * height > MAX_TRACED_PIXELS) return null
  const inside = new Uint8Array(width * height)
  for (let i = 0; i < inside.length; i++) inside[i] = rgba[i * 4 + 3] >= INSIDE_ALPHA ? 1 : 0
  const fit = { tolerance: 0.5, cornerAngle: (70 * Math.PI) / 180, width, height }
  const d = traceMask(inside, width, height)
    .map((loop) => fitLoopPath(loop, fit))
    .filter((part) => part.length > 0)
    .join('')
  return d || null
}
