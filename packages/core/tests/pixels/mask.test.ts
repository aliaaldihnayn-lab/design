import { describe, expect, test } from 'bun:test'

import {
  combineMasks,
  createMask,
  ellipseMask,
  featherMask,
  invertMask,
  maskBounds,
  maskOutline,
  rectMask
} from '#core/pixels/mask'

const count = (mask: { data: Uint8Array }) => mask.data.reduce((n, v) => n + (v >= 128 ? 1 : 0), 0)

describe('pixel selections', () => {
  test('a rectangle selects the pixels whose centres it covers', () => {
    const mask = rectMask(10, 10, { x: 2, y: 3, width: 4, height: 2 })
    expect(count(mask)).toBe(8)
    expect(maskBounds(mask)).toEqual({ x: 2, y: 3, width: 4, height: 2 })
  })

  test('an ellipse selects about π/4 of its box with a soft edge', () => {
    const mask = ellipseMask(100, 100, { x: 0, y: 0, width: 100, height: 100 })
    expect(Math.abs(count(mask) - Math.PI * 2500)).toBeLessThan(100)
    expect(mask.data[50 * 100 + 50]).toBe(255)
    expect(mask.data[0]).toBe(0)
  })

  test('selection modes add, subtract, and intersect', () => {
    const a = rectMask(10, 1, { x: 0, y: 0, width: 6, height: 1 })
    const b = rectMask(10, 1, { x: 4, y: 0, width: 6, height: 1 })
    expect(count(combineMasks(a, b, 'add'))).toBe(10)
    expect(count(combineMasks(a, b, 'subtract'))).toBe(4)
    expect(count(combineMasks(a, b, 'intersect'))).toBe(2)
    expect(combineMasks(a, b, 'replace')).toBe(b)
  })

  test('invert and feather', () => {
    const mask = rectMask(40, 40, { x: 10, y: 10, width: 20, height: 20 })
    expect(count(invertMask(mask))).toBe(1600 - 400)
    const soft = featherMask(mask, 6)
    expect(soft.data[20 * 40 + 20]).toBe(255)
    const edge = soft.data[20 * 40 + 10]
    expect(edge).toBeGreaterThan(60)
    expect(edge).toBeLessThan(200)
    expect(featherMask(createMask(4, 4, 255), 3).data.every((v) => v === 255)).toBe(true)
  })

  test('a rectangle outlines as four merged edges', () => {
    const outline = maskOutline(rectMask(10, 10, { x: 2, y: 2, width: 3, height: 3 }))
    expect(outline.length).toBe(16)
  })
})
