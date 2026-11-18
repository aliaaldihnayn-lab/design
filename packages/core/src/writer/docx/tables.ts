import { numberAttr, type WriterNode } from '#core/writer/model'

const TWIPS_PER_PX = 15

export type GridSlot =
  | { kind: 'start'; cell: WriterNode; column: number }
  | { kind: 'continue'; column: number; span: number; cell: null }
  | { kind: 'covered'; column: number }

type PendingMerges = Map<number, { rowsLeft: number; span: number }>

/** Fills the columns cells merged from above hold, from `column` on; returns the next free one. */
function placeContinuations(pending: PendingMerges, slots: GridSlot[], start: number): number {
  let column = start
  for (let merge = pending.get(column); merge; merge = pending.get(column)) {
    slots.push({ kind: 'continue', column, span: merge.span, cell: null })
    for (let i = 1; i < merge.span; i += 1) slots.push({ kind: 'covered', column: column + i })
    merge.rowsLeft -= 1
    if (merge.rowsLeft === 0) pending.delete(column)
    column += merge.span
  }
  return column
}

/** Lays a table's cells on Word's grid, so row spans become `vMerge` continuations. */
export function tableGrid(rows: readonly WriterNode[]): { columns: number; rows: GridSlot[][] } {
  const pending: PendingMerges = new Map()
  const out: GridSlot[][] = []
  let columns = 0
  for (const row of rows) {
    const slots: GridSlot[] = []
    let column = 0
    const cells = [...(row.content ?? [])]
    for (const cell of cells) {
      column = placeContinuations(pending, slots, column)
      const span = numberAttr(cell.attrs, 'colspan') ?? 1
      const rowspan = numberAttr(cell.attrs, 'rowspan') ?? 1
      slots.push({ kind: 'start', cell, column })
      for (let i = 1; i < span; i += 1) slots.push({ kind: 'covered', column: column + i })
      if (rowspan > 1) pending.set(column, { rowsLeft: rowspan - 1, span })
      column += span
    }
    column = placeContinuations(pending, slots, column)
    columns = Math.max(columns, column)
    out.push(slots)
  }
  return { columns, rows: out }
}

export function columnWidths(
  rows: readonly WriterNode[],
  columns: number,
  textWidth: number
): number[] {
  const widths: Array<number | null> = Array.from({ length: columns }, () => null)
  for (const row of rows) {
    let column = 0
    for (const cell of row.content ?? []) {
      const colwidth = cell.attrs?.colwidth
      const span = numberAttr(cell.attrs, 'colspan') ?? 1
      if (Array.isArray(colwidth)) {
        for (const [index, value] of colwidth.entries()) {
          if (typeof value === 'number' && widths[column + index] === null) {
            widths[column + index] = Math.round(value * TWIPS_PER_PX)
          }
        }
      }
      column += span
    }
  }
  const known = widths.reduce<number>((sum, width) => sum + (width ?? 0), 0)
  const unknown = widths.filter((width) => width === null).length
  const rest = unknown ? Math.max(360, Math.round((textWidth - known) / unknown)) : 0
  return widths.map((width) => width ?? rest)
}
