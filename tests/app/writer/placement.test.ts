import { describe, expect, test } from 'bun:test'

import { boxFromGesture, boxToRect, defaultBox, rectToBox } from '@/app/writer/placement'

const A4 = { width: 595, height: 842 }

describe('placing a visible signature', () => {
  test('a drag becomes that rectangle in PDF points from the bottom-left corner', () => {
    const box = boxFromGesture({ x: 0.1, y: 0.5 }, { x: 0.5, y: 0.6 }, A4)
    const [x, y, width, height] = boxToRect(box, A4)
    expect(x).toBeCloseTo(59.5)
    expect(width).toBeCloseTo(238)
    expect(height).toBeCloseTo(84.2)
    // Its top is 50% down the page, so its bottom sits 40% up from the bottom edge.
    expect(y).toBeCloseTo(842 * 0.4)
  })

  test('dragging up and left gives the same rectangle as dragging down and right', () => {
    const down = boxFromGesture({ x: 0.2, y: 0.2 }, { x: 0.4, y: 0.3 }, A4)
    const up = boxFromGesture({ x: 0.4, y: 0.3 }, { x: 0.2, y: 0.2 }, A4)
    expect(up).toEqual(down)
  })

  test('a click centres a stamp-sized signature on the point, inside the page', () => {
    const centre = boxToRect(boxFromGesture({ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }, A4), A4)
    expect(centre[2]).toBeCloseTo(180)
    expect(centre[3]).toBeCloseTo(60)
    expect(centre[0] + centre[2] / 2).toBeCloseTo(297.5)
    const corner = boxToRect(boxFromGesture({ x: 1, y: 1 }, { x: 1, y: 1 }, A4), A4)
    expect(corner[0] + corner[2]).toBeCloseTo(595)
    expect(corner[1]).toBeCloseTo(0)
  })

  test('a field the file has shows where it is', () => {
    const rect: [number, number, number, number] = [72, 72, 160, 50]
    expect(boxToRect(rectToBox(rect, A4), A4)).toEqual(rect)
  })

  test('without a placement the signature goes to the bottom corner the text ends at', () => {
    const ltr = boxToRect(defaultBox(A4, false), A4)
    const rtl = boxToRect(defaultBox(A4, true), A4)
    expect(ltr[0] + ltr[2]).toBeCloseTo(595 - 36)
    expect(rtl[0]).toBeCloseTo(36)
    expect(ltr[1]).toBeCloseTo(36)
  })
})
