import { describe, expect, test } from 'bun:test'

import { createStrokeCoverage, type BrushTip } from '#core/pixels/brush'
import { cloneDab } from '#core/pixels/clone'
import { blankImage } from '#core/pixels/composite'

const tip: BrushTip = { size: 6, hardness: 1, opacity: 1 }

/** A 40 × 20 picture: a checker of 2 px squares on the left, flat grey on the right. */
function picture() {
  const image = blankImage(40, 20)
  for (let y = 0; y < 20; y++) {
    for (let x = 0; x < 40; x++) {
      const value = x < 20 ? ((Math.floor(x / 2) + Math.floor(y / 2)) % 2 ? 200 : 100) : 120
      image.data.set([value, value, value, 255], (y * 40 + x) * 4)
    }
  }
  return image
}

const red = (image: { width: number; data: Uint8Array }, x: number, y: number) =>
  image.data[(y * image.width + x) * 4]

describe('clone stamp', () => {
  test('copies the source pixels at the offset onto the paint layer', () => {
    const source = picture()
    const paint = blankImage(40, 20)
    const before = paint.data.slice()
    cloneDab(paint, before, createStrokeCoverage(paint), { x: 30, y: 10 }, tip, {
      source,
      offset: { x: -20, y: 0 }
    })
    for (const [x, y] of [
      [29, 9],
      [30, 10],
      [31, 11]
    ]) {
      expect(red(paint, x, y)).toBe(red(source, x - 20, y))
    }
    expect(paint.data[(0 * 40 + 0) * 4 + 3]).toBe(0)
  })

  test('takes nothing from outside the picture', () => {
    const paint = blankImage(40, 20)
    cloneDab(paint, paint.data.slice(), createStrokeCoverage(paint), { x: 2, y: 10 }, tip, {
      source: picture(),
      offset: { x: -30, y: 0 }
    })
    expect(paint.data.every((value) => value === 0)).toBe(true)
  })
})
