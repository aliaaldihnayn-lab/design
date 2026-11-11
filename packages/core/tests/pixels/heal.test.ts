import { describe, expect, test } from 'bun:test'

import type { Vector } from '@lawha/scene-graph/primitives'

import type { RGBAImage } from '#core/io/formats/raster'
import { createStrokeCoverage, dabSpacing, strokeDabs, type BrushTip } from '#core/pixels/brush'
import { cloneDab, type CloneSampling } from '#core/pixels/clone'
import { blankImage, compositeOver } from '#core/pixels/composite'
import {
  createHealingStroke,
  finishHealingStroke,
  healDab,
  regionOf,
  solvePoisson
} from '#core/pixels/heal'

describe('Poisson solver', () => {
  test('a flat guide inside a constant edge solves to that constant', () => {
    const region = regionOf(12, 12, (i) => i % 12 > 2 && i % 12 < 9 && i > 36 && i < 108)
    const values = solvePoisson(region, { guide: () => 0, boundary: () => 77 })
    for (const value of values) expect(value).toBeCloseTo(77, 1)
  })

  test("copies the guide's gradients exactly when the edge agrees with them", () => {
    // Guide is a ramp; the edge is the same ramp lifted by 40, so the answer is ramp + 40.
    const width = 16
    const ramp = (i: number) => (i % width) * 5 + Math.floor(i / width) * 2
    const region = regionOf(width, 16, (i) => {
      const x = i % width
      const y = Math.floor(i / width)
      return x > 3 && x < 12 && y > 3 && y < 12
    })
    const values = solvePoisson(region, { guide: ramp, boundary: (q) => ramp(q) + 40 })
    region.pixels.forEach((index, s) => expect(values[s]).toBeCloseTo(ramp(index) + 40, 1))
  })
})

const W = 80
const H = 40

/**
 * A picture with a strong left-to-right shading on its right half, where the healing lands, and
 * a 2 px checker on flat grey on its left half, the clean texture healing copies from.
 */
function picture(): RGBAImage {
  const image = blankImage(W, H)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const value =
        x < 40
          ? 110 + ((Math.floor(x / 2) + Math.floor(y / 2)) % 2 ? 20 : -20)
          : 60 + (x - 40) * 3 + y * 2
      image.data.set([value, value, value, 255], (y * W + x) * 4)
    }
  }
  return image
}

const tip: BrushTip = { size: 12, hardness: 1, opacity: 1 }
const sampling = (source: RGBAImage): CloneSampling => ({ source, offset: { x: -40, y: 0 } })

/** Runs a horizontal stroke over the shading, cloning or healing, and returns what it shows. */
function stroke(kind: 'clone' | 'heal', source: RGBAImage) {
  const paint = blankImage(W, H)
  const before = paint.data.slice()
  const coverage = createStrokeCoverage(paint)
  const healing = kind === 'heal' ? createHealingStroke(sampling(source)) : null
  const dab = (at: Vector) =>
    healing
      ? healDab(paint, before, coverage, at, tip, healing)
      : cloneDab(paint, before, coverage, at, tip, sampling(source))
  const from = { x: 52, y: 20 }
  dab(from)
  for (const at of strokeDabs(from, { x: 68, y: 20 }, dabSpacing(tip), 0).dabs) dab(at)
  if (healing) finishHealingStroke(paint, before, coverage, healing)
  return { shown: compositeOver(source, paint), coverage }
}

/** The mean over the 4 × 4 block around a pixel, which averages the 2 px checker away. */
function smooth(image: RGBAImage, p: number): number {
  const x = p % W
  const y = Math.floor(p / W)
  let sum = 0
  for (let dy = -2; dy < 2; dy++) {
    for (let dx = -2; dx < 2; dx++) {
      const sx = Math.max(0, Math.min(W - 1, x + dx))
      const sy = Math.max(0, Math.min(H - 1, y + dy))
      sum += image.data[(sy * W + sx) * 4]
    }
  }
  return sum / 16
}

/**
 * How visible the patch's edge is: the mean jump in tone (the texture averaged away) across each
 * edge between a painted pixel and an untouched neighbour, less the jump the picture had there.
 */
function seamError(shown: RGBAImage, original: RGBAImage, coverage: Float32Array): number {
  let total = 0
  let count = 0
  for (let y = 0; y < H; y++) {
    for (let x = 41; x < W - 1; x++) {
      const p = y * W + x
      for (const q of [p - 1, p + 1, p - W, p + W]) {
        if (q < 0 || q >= W * H) continue
        if (coverage[p] <= 0 || coverage[q] > 0) continue
        const jump = Math.abs(smooth(shown, p) - smooth(shown, q))
        const natural = Math.abs(smooth(original, p) - smooth(original, q))
        total += Math.abs(jump - natural)
        count++
      }
    }
  }
  return total / count
}

/** The checker's contrast inside the patch: neighbours across a checker edge stay apart. */
function textureContrast(shown: RGBAImage, coverage: Float32Array): number {
  let total = 0
  let count = 0
  for (let x = 54; x < 66; x += 2) {
    const p = 20 * W + x
    if (coverage[p] < 1 || coverage[p + 2] < 1) continue
    // Pixels two apart sit on opposite checker squares; remove the shading's own slope.
    total += Math.abs(shown.data[p * 4] - shown.data[(p + 2) * 4]) - 6
    count++
  }
  return total / count
}

describe('healing brush', () => {
  test('leaves a far fainter seam than cloning, against a shaded background', () => {
    const original = picture()
    const cloned = stroke('clone', original)
    const healed = stroke('heal', original)
    const clonedSeam = seamError(cloned.shown, original, cloned.coverage)
    const healedSeam = seamError(healed.shown, original, healed.coverage)
    expect(clonedSeam).toBeGreaterThan(5)
    expect(healedSeam).toBeLessThan(clonedSeam / 5)
  })

  test("does better than any single colour shift, which can't follow the shading", () => {
    const original = picture()
    const cloned = stroke('clone', original)
    const healed = stroke('heal', original)
    // The best one shift for the whole patch: the mean gap along its edge.
    let gap = 0
    let edges = 0
    for (let p = 0; p < W * H; p++) {
      if (cloned.coverage[p] <= 0) continue
      for (const q of [p - 1, p + 1, p - W, p + W]) {
        if (q < 0 || q >= W * H || cloned.coverage[q] > 0) continue
        gap += original.data[q * 4] - cloned.shown.data[p * 4]
        edges++
      }
    }
    const shifted = blankImage(W, H)
    shifted.data.set(cloned.shown.data)
    for (let p = 0; p < W * H; p++) {
      if (cloned.coverage[p] <= 0) continue
      const value = Math.max(0, Math.min(255, shifted.data[p * 4] + gap / edges))
      shifted.data.fill(Math.round(value), p * 4, p * 4 + 3)
    }
    const shiftSeam = seamError(shifted, original, cloned.coverage)
    const healedSeam = seamError(healed.shown, original, healed.coverage)
    expect(healedSeam).toBeLessThan(shiftSeam / 3)
  })

  test("keeps the source's texture inside the patch", () => {
    const healed = stroke('heal', picture())
    expect(textureContrast(healed.shown, healed.coverage)).toBeGreaterThan(30)
  })
})
