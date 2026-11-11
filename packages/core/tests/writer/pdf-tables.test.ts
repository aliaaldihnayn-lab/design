import { describe, expect, test } from 'bun:test'

import type { TableCell } from '#core/writer/pdf/flow'
import { placeCells, rowBands } from '#core/writer/pdf/paginate'

const cell = (colspan = 1, rowspan = 1): TableCell => ({
  blocks: [],
  colspan,
  rowspan,
  header: false,
  background: null
})

describe('PDF tables with merged cells', () => {
  test('a cell running down keeps its column in the rows below', () => {
    // | A (2 rows) | B |
    // |            | C |
    // | D     | E      |
    const a = cell(1, 2)
    const rows = [[a, cell()], [cell()], [cell(), cell()]]
    const placed = placeCells(rows)
    expect(placed.map((entry) => [entry.row, entry.column])).toEqual([
      [0, 0],
      [0, 1],
      [1, 1],
      [2, 0],
      [2, 1]
    ])
    expect(rowBands(placed, rows.length)).toEqual([
      { from: 0, to: 2 },
      { from: 2, to: 3 }
    ])
  })

  test('a merged cell over a column span skips every column it covers', () => {
    const rows = [[cell(2, 3), cell()], [cell()], [cell()], [cell(), cell(), cell()]]
    const placed = placeCells(rows)
    expect(placed.filter((entry) => entry.row > 0 && entry.row < 3).map((e) => e.column)).toEqual([
      2, 2
    ])
    expect(rowBands(placed, rows.length)).toEqual([
      { from: 0, to: 3 },
      { from: 3, to: 4 }
    ])
  })
})
