import type { Element } from '@xmldom/xmldom'

import type { Fill, SceneNode, Stroke } from '@lawha/scene-graph'
import { BLACK, WHITE } from '@lawha/scene-graph/constants'
import type { Color } from '@lawha/scene-graph/primitives'

import { addChart } from './chart'
import { imageFill, readFills, readStrokes } from './paint'
import { placement, readBox, skip, type FrameInfo, type ShapeContext, type Space } from './space'
import { EMU_PER_PX, levelStyle, readTextBody, textNodeProps, type TextStyle } from './text'
import { themeColor } from './theme'
import { attr, boolAttr, child, children, descend, numAttr, relAttr } from './xml'

/**
 * PowerPoint's graphic frames, which hold what is not a shape: tables become a frame of cell
 * frames with their fills, borders and live text; charts a frame of editable shapes drawn from
 * the values the chart caches (`./chart`); SmartArt the shapes PowerPoint saved for it; and other
 * objects, such as embedded OLE files, their preview picture.
 */

export type ShapeWalker = (ctx: ShapeContext, parentId: string, tree: Element, space: Space) => void

export function addGraphicFrame(
  ctx: ShapeContext,
  parentId: string,
  frame: Element,
  space: Space,
  walk: ShapeWalker
): void {
  const cNvPr = descend(frame, 'nvGraphicFramePr', 'cNvPr')
  const box = readBox(child(frame, 'xfrm'), space)
  if (!box) {
    skip(ctx, 'graphic frame without position')
    return
  }
  const info = {
    name: attr(cNvPr, 'name') ?? '',
    visible: !(boolAttr(cNvPr, 'hidden') ?? false),
    box
  }
  const data = descend(frame, 'graphic', 'graphicData')
  const uri = attr(data, 'uri') ?? ''
  const table = child(data, 'tbl')
  if (table) {
    addTable(ctx, parentId, table, info)
    return
  }
  if (uri.endsWith('/chart') && addChart(ctx, parentId, data, info)) return
  if (uri.endsWith('/diagram') && addDiagram(ctx, parentId, data, info, space, walk)) return
  if (addPreview(ctx, parentId, data, info)) return
  skip(ctx, uri.endsWith('/chart') ? 'chart' : `graphic ${uri.split('/').pop() ?? ''}`)
}

// ── Tables ───────────────────────────────────────────────

/** PowerPoint's default table style, Medium Style 2 – Accent 1, which most tables keep. */
function defaultCellFill(ctx: ShapeContext, row: number, header: boolean, banded: boolean) {
  const accent = themeColor(ctx.theme, 'accent1') ?? { r: 0.27, g: 0.45, b: 0.77, a: 1 }
  if (header && row === 0) return accent
  const tint = banded && (row - (header ? 1 : 0)) % 2 === 0 ? 0.6 : 0.8
  const mix = (v: number) => v + (1 - v) * tint
  return { r: mix(accent.r), g: mix(accent.g), b: mix(accent.b), a: 1 }
}

function solidFill(color: Color): Fill {
  return { type: 'SOLID', color: { ...color }, opacity: 1, visible: true }
}

/** Positions along an axis from sizes, scaled so they fill `total`. */
function offsets(sizes: number[], total: number): number[] {
  const sum = sizes.reduce((a, b) => a + b, 0)
  const scale = sum > 0 ? total / sum : 1
  const out = [0]
  for (const size of sizes) out.push((out.at(-1) ?? 0) + size * scale)
  return out
}

const ANCHOR: Record<string, SceneNode['textAlignVertical']> = {
  t: 'TOP',
  ctr: 'CENTER',
  b: 'BOTTOM'
}

/** A cell's borders: the first side it draws, as one stroke inside the cell. */
function cellStrokes(ctx: ShapeContext, tcPr: Element | undefined): Stroke[] | null {
  for (const side of ['lnT', 'lnB', 'lnL', 'lnR']) {
    const ln = child(tcPr, side)
    if (!ln) continue
    const strokes = readStrokes(ctx, ln, undefined)
    if (strokes.length > 0) return strokes.map((stroke) => ({ ...stroke, align: 'INSIDE' }))
  }
  return null
}

function addTable(ctx: ShapeContext, parentId: string, table: Element, info: FrameInfo): void {
  const { box } = info
  const tblPr = child(table, 'tblPr')
  const header = boolAttr(tblPr, 'firstRow') ?? false
  const banded = boolAttr(tblPr, 'bandRow') ?? false
  const styled = child(tblPr, 'tableStyleId') !== undefined || header || banded
  const columns = children(child(table, 'tblGrid'), 'gridCol').map((col) => numAttr(col, 'w') ?? 0)
  const rows = children(table, 'tr')
  const xs = offsets(columns, box.width)
  const ys = offsets(
    rows.map((row) => numAttr(row, 'h') ?? 0),
    box.height
  )
  const frame = ctx.graph.createNode('FRAME', parentId, {
    name: info.name || 'Table',
    visible: info.visible,
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    fills: [],
    clipsContent: false,
    ...placement(box)
  })
  rows.forEach((row, r) => {
    children(row, 'tc').forEach((cell, c) => {
      // Cells a merge covers draw nothing of their own.
      if (boolAttr(cell, 'hMerge') || boolAttr(cell, 'vMerge')) return
      const span = Math.max(1, numAttr(cell, 'gridSpan') ?? 1)
      const rowSpan = Math.max(1, numAttr(cell, 'rowSpan') ?? 1)
      const x = xs[c] ?? 0
      const y = ys[r] ?? 0
      const width = (xs[Math.min(c + span, columns.length)] ?? box.width) - x
      const height = (ys[Math.min(r + rowSpan, rows.length)] ?? box.height) - y
      const tcPr = child(cell, 'tcPr')
      const ownFills = readFills(ctx, tcPr, { width, height })
      const isHeader = header && r === 0
      const fills = ownFills ?? (styled ? [solidFill(defaultCellFill(ctx, r, header, banded))] : [])
      const strokes =
        cellStrokes(ctx, tcPr) ??
        (styled ? [{ ...solidFill(WHITE), weight: 1, align: 'INSIDE' as const }] : [])
      const cellFrame = ctx.graph.createNode('FRAME', frame.id, {
        name: `Cell ${r + 1}:${c + 1}`,
        x,
        y,
        width,
        height,
        fills,
        strokes,
        clipsContent: true
      })
      addCellText(ctx, cellFrame.id, cell, { width, height }, isHeader, styled)
    })
  })
}

/** A cell's text inside its margins, in the table style's colour when the table has one. */
function addCellText(
  ctx: ShapeContext,
  cellId: string,
  cell: Element,
  size: { width: number; height: number },
  isHeader: boolean,
  styled: boolean
) {
  const tcPr = child(cell, 'tcPr')
  const txBody = child(cell, 'txBody')
  // Cell text inherits the presentation's default text style, in the theme's body font.
  const fonts: TextStyle = { latin: ctx.theme.fonts.minor, size: 18 }
  if (ctx.theme.fonts.minorCS) fonts.cs = ctx.theme.fonts.minorCS
  if (isHeader) fonts.bold = true
  const body = txBody
    ? readTextBody(txBody, ctx.theme, (level) => ({
        ...fonts,
        ...levelStyle(ctx.placeholders.defaultText, level, ctx.theme)
      }))
    : null
  if (!body) return
  const margin = (name: string, fallback: number) => (numAttr(tcPr, name) ?? fallback) / EMU_PER_PX
  const left = margin('marL', 91440)
  const right = margin('marR', 91440)
  const top = margin('marT', 45720)
  const bottom = margin('marB', 45720)
  const textColor = isHeader
    ? (themeColor(ctx.theme, 'lt1') ?? WHITE)
    : (themeColor(ctx.theme, 'dk1') ?? BLACK)
  ctx.graph.createNode('TEXT', cellId, {
    ...textNodeProps(body, styled ? textColor : undefined),
    name: 'Text',
    x: left,
    y: top,
    width: Math.max(1, size.width - left - right),
    height: Math.max(1, size.height - top - bottom),
    textAlignVertical: ANCHOR[attr(tcPr, 'anchor') ?? 't'] ?? 'TOP'
  })
}

// ── SmartArt ─────────────────────────────────────────────

/**
 * The drawing PowerPoint saves beside a SmartArt's data, which any reader can draw: named by
 * the data part's `dataModelExt`, else the slide's only diagram drawing.
 */
function diagramDrawing(ctx: ShapeContext, data: Element | undefined): string | null {
  const rels = ctx.pkg.rels(ctx.part)
  const dataPart = rels.get(relAttr(child(data, 'relIds'), 'dm') ?? '')?.target
  const ext = (el: Element | null | undefined): Element | undefined => {
    if (!el) return undefined
    if (el.localName === 'dataModelExt') return el
    for (const item of children(el)) {
      const found = ext(item)
      if (found) return found
    }
    return undefined
  }
  const relId = attr(ext(dataPart ? ctx.pkg.xml(dataPart) : null), 'relId')
  const named = relId ? rels.get(relId) : undefined
  if (named && !named.external) return named.target
  const drawings = [...rels.values()].filter(
    (rel) => !rel.external && rel.type.endsWith('/diagramDrawing')
  )
  return drawings.length === 1 ? drawings[0].target : null
}

function addDiagram(
  ctx: ShapeContext,
  parentId: string,
  data: Element | undefined,
  info: FrameInfo,
  space: Space,
  walk: ShapeWalker
): boolean {
  const part = diagramDrawing(ctx, data)
  const tree = part ? descend(ctx.pkg.xml(part), 'spTree') : undefined
  if (!part || !tree) return false
  const { box } = info
  const group = ctx.graph.createNode('GROUP', parentId, {
    name: info.name || 'SmartArt',
    visible: info.visible,
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height
  })
  // The drawing's shapes sit in the frame's own space, from its top left corner.
  walk({ ...ctx, part, drawPlaceholders: true }, group.id, tree, {
    originX: 0,
    originY: 0,
    scaleX: space.scaleX,
    scaleY: space.scaleY
  })
  if (ctx.graph.getChildren(group.id).length === 0) {
    ctx.graph.deleteNode(group.id)
    return false
  }
  return true
}

// ── Other objects ────────────────────────────────────────

function findBlipFill(el: Element | undefined, depth = 0): Element | undefined {
  if (!el || depth > 6) return undefined
  for (const item of children(el)) {
    if (item.localName === 'blipFill') return item
    const found = findBlipFill(item, depth + 1)
    if (found) return found
  }
  return undefined
}

/** An embedded object's preview picture, as PowerPoint shows it until it is opened. */
function addPreview(
  ctx: ShapeContext,
  parentId: string,
  data: Element | undefined,
  info: FrameInfo
): boolean {
  const fill = imageFill(ctx, findBlipFill(data))
  if (!fill) return false
  const { box } = info
  ctx.graph.createNode('RECTANGLE', parentId, {
    name: info.name || 'Object',
    visible: info.visible,
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    fills: [fill],
    ...placement(box)
  })
  return true
}
