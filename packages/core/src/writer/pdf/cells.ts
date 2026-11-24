import type { TableCell } from './flow'
import type { DrawOp } from './paginate'

/** Table cells on the page: where each sits in the grid, and the ops that draw and move them. */

const BORDER = 0.5

/** An op moved down by `dy`. */
export function offset(op: DrawOp, dy: number): DrawOp {
  switch (op.kind) {
    case 'glyphs':
      return { ...op, baseline: op.baseline + dy }
    case 'watermark':
      return { ...op, cy: op.cy + dy }
    default:
      return { ...op, y: op.y + dy }
  }
}

/** How far down an op reaches, for breaking a band between pages; glyphs by their size. */
export function extentOf(op: DrawOp): { op: DrawOp; top: number; bottom: number } {
  switch (op.kind) {
    case 'glyphs':
      return { op, top: op.baseline - op.piece.size, bottom: op.baseline + op.piece.size * 0.3 }
    case 'watermark':
      return { op, top: op.cy, bottom: op.cy }
    default:
      return { op, top: op.y, bottom: op.y + op.height }
  }
}

export function borderOps(x: number, y: number, width: number, height: number): DrawOp[] {
  const color = '#000000'
  return [
    { kind: 'rect', x, y, width, height: BORDER, color },
    { kind: 'rect', x, y: y + height - BORDER, width, height: BORDER, color },
    { kind: 'rect', x, y, width: BORDER, height, color },
    { kind: 'rect', x: x + width - BORDER, y, width: BORDER, height, color }
  ]
}

/** A cell with the row it starts in and the grid column it starts at. */
export interface PlacedCell {
  cell: TableCell
  row: number
  column: number
}

/** A placed cell with its edges and its content laid out from its own top. */
export type LaidCell = PlacedCell & { left: number; right: number; ops: DrawOp[]; height: number }

/**
 * Puts each cell in the table's grid. A cell that runs down several rows keeps its columns in
 * the rows below, whose own cells start after it, as HTML and Word lay merged cells out.
 */
export function placeCells(rows: readonly TableCell[][]): PlacedCell[] {
  const taken = new Map<number, number>()
  const placed: PlacedCell[] = []
  rows.forEach((cells, row) => {
    let column = 0
    for (const cell of cells) {
      while ((taken.get(column) ?? -1) >= row) column += 1
      placed.push({ cell, row, column })
      for (let offset = 0; offset < cell.colspan; offset += 1) {
        taken.set(column + offset, row + cell.rowspan - 1)
      }
      column += cell.colspan
    }
  })
  return placed
}

/** Runs of rows a page must not break inside, because a cell runs down across them. */
export function rowBands(
  placed: readonly PlacedCell[],
  count: number
): Array<{ from: number; to: number }> {
  const bands: Array<{ from: number; to: number }> = []
  let from = 0
  let to = 0
  for (let row = 0; row < count; row += 1) {
    for (const entry of placed) {
      if (entry.row === row) to = Math.max(to, Math.min(count, row + entry.cell.rowspan))
    }
    to = Math.max(to, row + 1)
    if (to === row + 1) {
      bands.push({ from, to })
      from = to
    }
  }
  return bands
}
