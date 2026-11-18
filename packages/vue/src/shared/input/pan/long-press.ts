import type { Vector } from '@lawha/scene-graph/primitives'

/** How long a still finger presses before the canvas menu opens, as on iOS and Android. */
export const LONG_PRESS_MS = 500
/** How far, in screen pixels, a finger may drift and still count as held still. */
export const LONG_PRESS_SLOP = 8

/** Runs `run` after `ms`, returning what cancels it; `setTimeout` outside tests. */
export type LongPressScheduler = (run: () => void, ms: number) => () => void

const timeoutScheduler: LongPressScheduler = (run, ms) => {
  const id = setTimeout(run, ms)
  return () => clearTimeout(id)
}

/**
 * Tracks one finger held still: `start` arms it at a point, a `move` beyond `LONG_PRESS_SLOP`
 * or a `cancel` disarms it, and after `LONG_PRESS_MS` held still `onFire` gets the start point.
 */
export function createLongPress(
  onFire: (point: Vector) => void,
  schedule: LongPressScheduler = timeoutScheduler
) {
  let start: Vector | null = null
  let cancelTimer: (() => void) | null = null

  function cancel() {
    cancelTimer?.()
    cancelTimer = null
    start = null
  }

  function begin(x: number, y: number) {
    cancel()
    const point = { x, y }
    start = point
    cancelTimer = schedule(() => {
      cancelTimer = null
      start = null
      onFire(point)
    }, LONG_PRESS_MS)
  }

  function move(x: number, y: number) {
    if (start && Math.hypot(x - start.x, y - start.y) > LONG_PRESS_SLOP) cancel()
  }

  return { start: begin, move, cancel, armed: () => start !== null }
}
