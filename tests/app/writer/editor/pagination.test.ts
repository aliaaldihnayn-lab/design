import { describe, expect, test } from 'bun:test'

import {
  layoutPages,
  sameLayout,
  type BlockBox,
  type BlockPiece
} from '@/app/writer/editor/pagination/layout'

const block = (top: number, bottom: number, breakAfter = false, section = 0): BlockBox => ({
  top,
  bottom,
  breakAfter,
  section
})
const page = (height: number) => () => height

/** A paragraph of lines `lineHeight` tall from `top`, each starting at position 10 + its index. */
function paragraph(top: number, lines: number, lineHeight: number): BlockBox {
  const pieces: BlockPiece[] = Array.from({ length: lines }, (_, index) => ({
    top: top + index * lineHeight,
    bottom: top + (index + 1) * lineHeight,
    pos: 10 + index
  }))
  return { ...block(top, top + lines * lineHeight), pieces, split: 'line' }
}

describe('editor pages', () => {
  test('a block that does not fit starts the next page, the rest of the page left empty', () => {
    const layout = layoutPages([block(0, 400), block(400, 800), block(800, 1100)], page(1000))
    expect(layout.breaks).toEqual([{ index: 2, fill: 200 }])
    expect(layout.pages).toBe(2)
    expect(layout.lastFill).toBe(700)
    expect(layout.sections).toEqual([0, 0])
  })

  test('a page break starts a page however much room is left', () => {
    const layout = layoutPages([block(0, 100, true), block(100, 200)], page(1000))
    expect(layout.breaks).toEqual([{ index: 1, fill: 900 }])
  })

  test('a block taller than a page that cannot be split stays whole on a page of its own', () => {
    const layout = layoutPages([block(0, 100), block(100, 2500), block(2500, 2600)], page(1000))
    expect(layout.breaks.map((entry) => entry.index)).toEqual([1, 2])
    expect(layout.pages).toBe(3)
  })

  test('a paragraph taller than a page splits between its lines', () => {
    // 50 lines of 50px from 100: lines 0-17 fill page one, 18-37 page two, the rest page three.
    const layout = layoutPages([block(0, 100), paragraph(100, 50, 50)], page(1000))
    expect(layout.breaks).toEqual([
      { index: 1, fill: 0, pos: 28, split: 'line' },
      { index: 1, fill: 0, pos: 48, split: 'line' }
    ])
    expect(layout.pages).toBe(3)
    expect(layout.lastFill).toBe(400)
  })

  test('a table taller than a page splits between its rows', () => {
    const rows: BlockPiece[] = [0, 1, 2, 3].map((index) => ({
      top: index * 400,
      bottom: (index + 1) * 400,
      pos: 100 + index * 20
    }))
    const table: BlockBox = { ...block(0, 1600), pieces: rows, split: 'row' }
    const layout = layoutPages([table], page(1000))
    expect(layout.breaks).toEqual([{ index: 0, fill: 200, pos: 140, split: 'row' }])
    expect(layout.pages).toBe(2)
  })

  test('each section breaks at its own page height', () => {
    const sectionBreak: BlockBox = { ...block(600, 620, true), endsSection: true }
    const heights = (section: number) => (section === 0 ? 1000 : 500)
    const layout = layoutPages(
      [block(0, 600), sectionBreak, block(620, 1020, false, 1), block(1020, 1220, false, 1)],
      heights
    )
    expect(layout.sections).toEqual([0, 1, 1])
    expect(layout.breaks.map((entry) => entry.index)).toEqual([2, 3])
    expect(layout.lastFill).toBe(300)
  })

  test('a page break at the end leaves an empty last page', () => {
    expect(layoutPages([block(0, 100, true)], page(1000)).pages).toBe(2)
  })

  test('layouts that round to the same pixels are the same', () => {
    const a = layoutPages([block(0, 600), block(600, 1200.2)], page(1000))
    const b = layoutPages([block(0, 600), block(600, 1200.4)], page(1000))
    expect(sameLayout(a, b)).toBe(true)
  })
})
