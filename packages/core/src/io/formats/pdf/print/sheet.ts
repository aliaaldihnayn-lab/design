import type { SceneGraph } from '@lawha/scene-graph'
import { colorToHex } from '@lawha/scene-graph/color'
import { computeBounds } from '@lawha/scene-graph/geometry'
import type { Rect } from '@lawha/scene-graph/primitives'

import type { PDFPageComposer } from '#core/io/formats/pdf/export'

import { REGISTRATION_SPOT } from './color'

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

/**
 * Lays each page's drawing on a sheet: the trim (the layers' own boxes) with `bleed` of artwork
 * past it on every side, and crop marks around in registration colour. What the layers draw
 * outside their box fills the bleed, and a solid background is carried out into it.
 */
export function composePrintSheet(graph: SceneGraph, layout: SheetLayout): PDFPageComposer {
  return (page) => {
    const trim = trimBox(graph, page.spec.nodeIds)
    if (!trim) return null
    const margin = markMargin(layout)
    const offset = margin + layout.bleed
    const width = trim.width + 2 * offset
    const height = trim.height + 2 * offset
    const dx = offset + page.origin.x - trim.x
    const dy = offset + page.origin.y - trim.y
    const background = bleedBackground(graph, page.spec.nodeIds)
    const bleedSize = `x="${margin}" y="${margin}" width="${trim.width + 2 * layout.bleed}" height="${trim.height + 2 * layout.bleed}"`
    const svg = [
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
      `<defs><clipPath id="lawha-print-bleed"><rect ${bleedSize}/></clipPath></defs>`,
      '<g clip-path="url(#lawha-print-bleed)">',
      background ? `<rect ${bleedSize} fill="${background}"/>` : '',
      `<g transform="translate(${dx} ${dy})">${svgInner(page.svg)}</g>`,
      '</g>',
      layout.cropMarks ? cropMarks(trim, offset, layout.bleed) : '',
      '</svg>'
    ].join('')
    return { svg, width, height }
  }
}
