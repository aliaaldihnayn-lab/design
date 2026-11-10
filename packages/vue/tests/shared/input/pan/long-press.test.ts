import { describe, expect, test } from 'bun:test'

import type { Vector } from '@lawha/scene-graph/primitives'

import {
  createLongPress,
  LONG_PRESS_MS,
  LONG_PRESS_SLOP,
  type LongPressScheduler
} from '#vue/shared/input/pan/long-press'

/** A scheduler the test runs by hand, recording the delay each press asked for. */
function manualScheduler() {
  const pending: { run: () => void; ms: number; cancelled: boolean }[] = []
  const schedule: LongPressScheduler = (run, ms) => {
    const entry = { run, ms, cancelled: false }
    pending.push(entry)
    return () => {
      entry.cancelled = true
    }
  }
  const elapse = () => {
    for (const entry of pending.splice(0)) if (!entry.cancelled) entry.run()
  }
  return { schedule, pending, elapse }
}

describe('long press', () => {
  test('a finger held still fires once, at the point it pressed', () => {
    const clock = manualScheduler()
    const fired: Vector[] = []
    const press = createLongPress((point) => fired.push(point), clock.schedule)
    press.start(100, 200)
    press.move(100 + LONG_PRESS_SLOP / 2, 200)
    expect(clock.pending[0]?.ms).toBe(LONG_PRESS_MS)
    clock.elapse()
    expect(fired).toEqual([{ x: 100, y: 200 }])
    expect(press.armed()).toBe(false)
  })

  test('a finger that drifts beyond the slop, or lifts, does not fire', () => {
    const clock = manualScheduler()
    let fired = 0
    const press = createLongPress(() => fired++, clock.schedule)
    press.start(0, 0)
    press.move(LONG_PRESS_SLOP + 1, 0)
    clock.elapse()
    press.start(0, 0)
    press.cancel()
    clock.elapse()
    expect(fired).toBe(0)
  })

  test('a new press replaces the one before it', () => {
    const clock = manualScheduler()
    const fired: Vector[] = []
    const press = createLongPress((point) => fired.push(point), clock.schedule)
    press.start(0, 0)
    press.start(50, 50)
    clock.elapse()
    expect(fired).toEqual([{ x: 50, y: 50 }])
  })
})
