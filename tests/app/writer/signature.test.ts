import { describe, expect, test } from 'bun:test'

import { inkBounds, placedSize } from '@/app/writer/signature'

function canvasWithInk(width: number, height: number, points: Array<[number, number]>) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (const [x, y] of points) data[(y * width + x) * 4 + 3] = 255
  return data
}

describe('visual signatures', () => {
  test('trim to the ink', () => {
    const data = canvasWithInk(10, 8, [
      [2, 3],
      [7, 5]
    ])
    expect(inkBounds(data, 10, 8)).toEqual({ x: 2, y: 3, width: 6, height: 3 })
    expect(inkBounds(new Uint8ClampedArray(10 * 8 * 4), 10, 8)).toBeNull()
  })

  test('are placed no wider than a signature line, keeping their shape', () => {
    expect(placedSize(880, 200)).toEqual({ width: 220, height: 50 })
    expect(placedSize(100, 40)).toEqual({ width: 100, height: 40 })
  })
})
