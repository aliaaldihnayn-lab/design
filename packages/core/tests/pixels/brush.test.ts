import { describe, expect, test } from 'bun:test'

import {
  createStrokeCoverage,
  dabCoverage,
  eraseDab,
  paintDab,
  strokeDabs,
  type BrushTip
} from '#core/pixels/brush'
import { blankImage, compositeOver, placeImage } from '#core/pixels/composite'
import { fillRegion, pixelColor, selectSimilar } from '#core/pixels/fill'

const RED = { r: 1, g: 0, b: 0, a: 1 }
const hard: BrushTip = { size: 10, hardness: 1, opacity: 1 }

function alphaAt(image: { width: number; data: Uint8Array }, x: number, y: number) {
  return image.data[(y * image.width + x) * 4 + 3]
}

describe('brush dabs', () => {
  test('a hard brush covers its disc fully and nothing past its rim', () => {
    expect(dabCoverage(0, hard)).toBe(1)
    expect(dabCoverage(4, hard)).toBe(1)
    expect(dabCoverage(5.6, hard)).toBe(0)
  })

  test('a soft brush fades from the centre outwards', () => {
    const soft = { ...hard, hardness: 0 }
    expect(dabCoverage(0.1, soft)).toBeGreaterThan(dabCoverage(2.5, soft))
    expect(dabCoverage(2.5, soft)).toBeGreaterThan(dabCoverage(4.5, soft))
  })

  test('dabs along a stroke stay evenly spaced across pointer samples', () => {
    const first = strokeDabs({ x: 0, y: 0 }, { x: 5, y: 0 }, 2, 0)
    const second = strokeDabs({ x: 5, y: 0 }, { x: 10, y: 0 }, 2, first.carry)
    const xs = [...first.dabs, ...second.dabs].map((dab) => dab.x)
    expect(xs).toEqual([2, 4, 6, 8, 10])
  })

  test('overlapping dabs of one stroke never build past the brush opacity', () => {
    const image = blankImage(20, 20)
    const before = image.data.slice()
    const coverage = createStrokeCoverage(image)
    const half = { ...hard, opacity: 0.5 }
    paintDab(image, before, coverage, { x: 10, y: 10 }, half, RED)
    paintDab(image, before, coverage, { x: 10.5, y: 10 }, half, RED)
    expect(alphaAt(image, 10, 10)).toBe(128)
    expect(pixelColor(image, 10, 10)?.r).toBe(1)
  })

  test('the eraser takes alpha away and keeps colour', () => {
    const image = blankImage(20, 20)
    fillRegion(image, selectSimilar(image, 0, 0, 0), RED)
    const before = image.data.slice()
    eraseDab(image, before, createStrokeCoverage(image), { x: 10, y: 10 }, hard)
    expect(alphaAt(image, 10, 10)).toBe(0)
    expect(alphaAt(image, 0, 0)).toBe(255)
  })
})

describe('fill bucket and colour picker', () => {
  test('a contiguous fill stops at an edge of a different colour', () => {
    const image = blankImage(10, 10)
    for (let y = 0; y < 10; y++) image.data.set([0, 0, 0, 255], (y * 10 + 5) * 4)
    const region = selectSimilar(image, 1, 1, 0.1, true)
    expect(region.data.reduce((sum, v) => sum + (v ? 1 : 0), 0)).toBe(50)
    expect(selectSimilar(image, 1, 1, 0.1, false).data[9]).toBe(255)
    expect(region.data[9]).toBe(0)
  })

  test('picks the colour shown at a point', () => {
    const image = blankImage(4, 4)
    image.data.set([10, 20, 30, 255], (2 * 4 + 1) * 4)
    expect(pixelColor(image, 1.5, 2.2)).toEqual({ r: 10 / 255, g: 20 / 255, b: 30 / 255, a: 1 })
    expect(pixelColor(image, 9, 9)).toBeNull()
  })
})

describe('placing and compositing', () => {
  test('Fill covers the grid, Fit leaves bands clear', () => {
    const wide = blankImage(4, 2)
    wide.data.fill(255)
    const fit = placeImage(wide, 4, 4, 'FIT')
    expect(alphaAt(fit, 0, 0)).toBe(0)
    expect(alphaAt(fit, 0, 2)).toBe(255)
    expect(alphaAt(placeImage(wide, 4, 4, 'FILL'), 0, 0)).toBe(255)
  })

  test('paint over a base shows the paint where it is opaque', () => {
    const base = blankImage(2, 1)
    base.data.set([0, 0, 255, 255, 0, 0, 255, 255])
    const paint = blankImage(2, 1)
    paint.data.set([255, 0, 0, 255], 0)
    const shown = compositeOver(base, paint)
    expect([...shown.data]).toEqual([255, 0, 0, 255, 0, 0, 255, 255])
  })
})
