import type { SceneGraph } from '@lawha/scene-graph'
import { colorToHex } from '@lawha/scene-graph/color'
import { computeBounds } from '@lawha/scene-graph/geometry'
import type { Rect } from '@lawha/scene-graph/primitives'

import type { PDFPageComposer } from '#core/io/formats/pdf/export'

import { DIELINE_SPOTS, REGISTRATION_SPOT } from './color'

/** The guide a print template outlines its bleed with, named so print export can find it. */
export const BLEED_GUIDE_NAME = 'Bleed'

/** Crop marks: this long, this far out from the trim past the bleed, this thick. */
const MARK_LENGTH = 18
const MARK_GAP = 3
const MARK_WEIGHT = 0.25

export interface SheetLayout {
  /** Points of artwork past the trim on every side. */
  bleed: number
  cropMarks: boolean
}

/** Room around the bleed for the crop marks, in points. */
export function markMargin(layout: SheetLayout): number {
  return layout.cropMarks ? MARK_GAP + MARK_LENGTH + 3 : 0
}

/** Tolerance, in points, for a guide or cut line to line up with the sheet. */
const ALIGN_TOLERANCE = 0.5
const HAIRLINE = 0.02

function absoluteRect(graph: SceneGraph, id: string): Rect | null {
  const node = graph.getNode(id)
  if (!node) return null
  const at = graph.getAbsolutePosition(id)
  return { x: at.x, y: at.y, width: node.width, height: node.height }
}

/**
 * The bleed a print template's sheet already holds around its trim, or null for artwork drawn
 * to its trim. A template (`create_print_template`, `convert_to_dieline`) is trim plus bleed,
 * outlined by a bleed guide covering the sheet, with its cut lines on the trim.
 */
export function artworkBleed(graph: SceneGraph, nodeId: string): number | null {
  const sheet = absoluteRect(graph, nodeId)
  if (!sheet) return null
  const cuts: Rect[] = []
  const guides: Rect[] = []
  const visit = (id: string, depth: number) => {
    for (const child of graph.getChildren(id)) {
      const box = absoluteRect(graph, child.id)
      if (box && child.name === BLEED_GUIDE_NAME) guides.push(box)
      // A straight cut is a hairline vector, given a hundredth of a point across.
      if (box && child.name === DIELINE_SPOTS.cut.name)
        cuts.push({
          ...box,
          width: box.width <= HAIRLINE ? 0 : box.width,
          height: box.height <= HAIRLINE ? 0 : box.height
        })
      if (depth < 2) visit(child.id, depth + 1)
    }
  }
  visit(nodeId, 0)
  const guide = guides.some(
    (box) =>
      Math.abs(box.x - sheet.x) <= ALIGN_TOLERANCE &&
      Math.abs(box.y - sheet.y) <= ALIGN_TOLERANCE &&
      Math.abs(box.width - sheet.width) <= ALIGN_TOLERANCE &&
      Math.abs(box.height - sheet.height) <= ALIGN_TOLERANCE
  )
  if (!guide || cuts.length === 0) return null
  const left = Math.min(...cuts.map((box) => box.x)) - sheet.x
  const top = Math.min(...cuts.map((box) => box.y)) - sheet.y
  const right = sheet.x + sheet.width - Math.max(...cuts.map((box) => box.x + box.width))
  const bottom = sheet.y + sheet.height - Math.max(...cuts.map((box) => box.y + box.height))
  const insets = [left, top, right, bottom]
  const bleed = Math.min(...insets)
  if (bleed <= ALIGN_TOLERANCE || Math.max(...insets) - bleed > ALIGN_TOLERANCE) return null
  return Math.round(bleed * 1000) / 1000
}

/** The layers' trim: the union of their boxes on the canvas. */
function trimBox(graph: SceneGraph, nodeIds: readonly string[]): Rect | null {
  const boxes = nodeIds.flatMap((id) => {
    const node = graph.getNode(id)
    if (!node?.visible) return []
    const at = graph.getAbsolutePosition(id)
    return [{ x: at.x, y: at.y, width: node.width, height: node.height }]
  })
  return boxes.length === 0 ? null : computeBounds(boxes)
}

function hex(color: { r: number; g: number; b: number }): string {
  return colorToHex({ ...color, a: 1 }).slice(0, 7)
}

/** A one-layer page's solid background, carried out into the bleed. */
function bleedBackground(graph: SceneGraph, nodeIds: readonly string[]): string | null {
  if (nodeIds.length !== 1) return null
  const node = graph.getNode(nodeIds[0])
  const fills = node?.fills.filter((fill) => fill.visible) ?? []
  const fill = fills.at(-1)
  if (fills.length !== 1 || fill?.type !== 'SOLID') return null
  const alpha = fill.opacity * fill.color.a * (node?.opacity ?? 1)
  return alpha >= 1 ? hex(fill.color) : null
}

function cropMarks(trim: Rect, offset: number, bleed: number): string {
  const near = bleed + MARK_GAP
  const far = near + MARK_LENGTH
  const left = offset
  const top = offset
  const right = offset + trim.width
  const bottom = offset + trim.height
  const lines: string[] = []
  for (const x of [left, right]) {
    const dir = x === left ? -1 : 1
    for (const y of [top, bottom]) {
      const vdir = y === top ? -1 : 1
      lines.push(`M${x + dir * near} ${y}H${x + dir * far}`)
      lines.push(`M${x} ${y + vdir * near}V${y + vdir * far}`)
    }
  }
  return `<path d="${lines.join('')}" fill="none" stroke="${hex(REGISTRATION_SPOT.color)}" stroke-width="${MARK_WEIGHT}"/>`
}

/** The inside of an `<svg>` document: what its root element holds. */
function svgInner(svg: string): string {
  return svg.replace(/^[\s\S]*?<svg\b[^>]*>/, '').replace(/<\/svg>\s*$/, '')
}

/** The bleed of a page whose one layer is a template that already holds its bleed. */
export function pageArtworkBleed(graph: SceneGraph, nodeIds: readonly string[]): number | null {
  return nodeIds.length === 1 ? artworkBleed(graph, nodeIds[0]) : null
}

/**
 * Lays each page's drawing on a sheet: the trim (the layers' own boxes) with `bleed` of artwork
 * past it on every side, and crop marks around in registration colour. What the layers draw
 * outside their box fills the bleed, and a solid background is carried out into it. A template
 * that already holds its bleed keeps it: its trim is inside, and no bleed is added again.
 */
export function composePrintSheet(graph: SceneGraph, layout: SheetLayout): PDFPageComposer {
  return (page) => {
    const box = trimBox(graph, page.spec.nodeIds)
    if (!box) return null
    const inner = pageArtworkBleed(graph, page.spec.nodeIds)
    const bleed = inner ?? layout.bleed
    const trim =
      inner === null
        ? box
        : {
            x: box.x + inner,
            y: box.y + inner,
            width: box.width - 2 * inner,
            height: box.height - 2 * inner
          }
    const margin = markMargin(layout)
    const offset = margin + bleed
    const width = trim.width + 2 * offset
    const height = trim.height + 2 * offset
    const dx = offset + page.origin.x - trim.x
    const dy = offset + page.origin.y - trim.y
    const background = inner === null ? bleedBackground(graph, page.spec.nodeIds) : null
    const bleedSize = `x="${margin}" y="${margin}" width="${trim.width + 2 * bleed}" height="${trim.height + 2 * bleed}"`
    const svg = [
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
      `<defs><clipPath id="lawha-print-bleed"><rect ${bleedSize}/></clipPath></defs>`,
      '<g clip-path="url(#lawha-print-bleed)">',
      background ? `<rect ${bleedSize} fill="${background}"/>` : '',
      `<g transform="translate(${dx} ${dy})">${svgInner(page.svg)}</g>`,
      '</g>',
      layout.cropMarks ? cropMarks(trim, offset, bleed) : '',
      '</svg>'
    ].join('')
    return { svg, width, height }
  }
}
