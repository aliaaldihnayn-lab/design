import { describe, expect, test } from 'bun:test'

import { layoutPages, sameLayout, type BlockBox } from '@/app/writer/editor/pagination/layout'

const block = (top: number, bottom: number, breakAfter = false): BlockBox => ({
  top,
  bottom,
  breakAfter
})

describe('editor pages', () => {
  test('a block that does not fit starts the next page, the rest of the page left empty', () => {
    const layout = layoutPages([block(0, 400), block(400, 800), block(800, 1100)], 1000)
    expect(layout.breaks).toEqual([{ index: 2, fill: 200 }])
    expect(layout.pages).toBe(2)
    expect(layout.lastFill).toBe(700)
  })

  test('a page break starts a page however much room is left', () => {
    const layout = layoutPages([block(0, 100, true), block(100, 200)], 1000)
    expect(layout.breaks).toEqual([{ index: 1, fill: 900 }])
  })

  test('a block taller than a page stays whole on a page of its own', () => {
    const layout = layoutPages([block(0, 100), block(100, 2500), block(2500, 2600)], 1000)
    expect(layout.breaks.map((entry) => entry.index)).toEqual([1, 2])
    expect(layout.pages).toBe(3)
  })

  test('a page break at the end leaves an empty last page', () => {
    expect(layoutPages([block(0, 100, true)], 1000).pages).toBe(2)
  })

  test('layouts that round to the same pixels are the same', () => {
    const a = layoutPages([block(0, 600), block(600, 1200.2)], 1000)
    const b = layoutPages([block(0, 600), block(600, 1200.4)], 1000)
    expect(sameLayout(a, b)).toBe(true)
  })
})
