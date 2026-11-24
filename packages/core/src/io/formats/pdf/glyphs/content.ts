import { uniq } from 'es-toolkit'

import type { PDFGlyphFace, PDFGlyphFont } from './fonts'
import { hex4, num, utf16Hex } from './numbers'

/** A glyph of a run: its ID, where its characters start in the run's text, and its placement. */
export interface PDFRunGlyph {
  glyph: number
  /** The UTF-16 offset in the run's text of the character the glyph starts. */
  cluster: number
  /** How far the pen moves after it, in points. */
  advance: number
  /** How far it is moved from the pen, in points; y runs up. */
  offsetX: number
  offsetY: number
}

/** Glyphs of one face at one size on one baseline, in the order they show, and their text. */
export interface PDFGlyphRun {
  face: PDFGlyphFace
  size: number
  /** The characters the glyphs stand for, in logical order. */
  text: string
  glyphs: readonly PDFRunGlyph[]
  /** Whether the run reads right to left, its glyphs shown from its last character. */
  rtl: boolean
}

export interface PDFGlyphRunPlacement {
  /** Where the run's pen starts: its left edge on its baseline. */
  x: number
  y: number
  /** The fill colour, or null to keep the one the content set before. */
  color: readonly [number, number, number] | null
  /** Points added after each space, as justified text spreads its words. */
  spaceExtra?: number
  /** The text render mode, 3 to draw nothing and keep the text selectable; 0 fills. */
  renderMode?: number
}

const SKEW = 0.21

/** Where glyphs are shown from to where (inclusive), in the order they are written. */
interface ActualTextSpan {
  start: number
  end: number
  text: string
}

interface GlyphTexts {
  /** The text each glyph stands for in the font's ToUnicode map. */
  texts: string[]
  /** The glyphs in the order they are written: by their place, not their index. */
  order: number[]
  /** Spans by the place in `order` they start at. */
  spans: Map<number, ActualTextSpan>
}

const MARK = /^\p{M}$/u

/** Characters right-to-left text draws as their mirror image, by the image's character. */
const MIRRORED = new Map(
  ['()', '[]', '{}', '<>', '«»', '‹›', '⁅⁆', '⟨⟩'].flatMap(([open = '', close = '']) => [
    [open, close],
    [close, open]
  ])
)

/**
 * Right-to-left text as it shows, which readers mirror back when they put it in logical order:
 * a bracket drawn mirrored reads as the bracket it looks like.
 */
const shownMirrored = (text: string) =>
  Array.from(text, (character) => MIRRORED.get(character) ?? character).join('')

/**
 * What each glyph stands for, the order the glyphs are written in, and the spans of ActualText
 * that say what glyphs spell where their ToUnicode entries cannot.
 *
 * Left-to-right text is written as it shows, each glyph standing for its cluster, and a span
 * only where that cannot say it: a cluster of several glyphs, or a glyph standing for other text
 * elsewhere, such as an alternate form. Readers lay
 * a span's text out left to right and then put right-to-left lines in logical order with the
 * bidirectional algorithm, as poppler does, which would reverse a span's characters. So
 * right-to-left text spells each cluster in a span of its own, which also tells apart letters an
 * Arabic font draws from one shared skeleton: the letter's glyphs first, so the span starts where
 * the letter does, then the marks and dots drawn over it.
 */
function glyphTexts(run: PDFGlyphRun, font: PDFGlyphFont): GlyphTexts {
  const starts = uniq(run.glyphs.map((glyph) => glyph.cluster)).sort((a, b) => a - b)
  const clusterText = (cluster: number) => {
    const next = starts.find((start) => start > cluster) ?? run.text.length
    return run.text.slice(cluster, next)
  }
  const advance = (index: number) => run.face.glyphAdvance(run.glyphs[index].glyph)
  const widestOf = (indices: readonly number[]) =>
    indices.reduce((best, index) => (advance(index) > advance(best) ? index : best))
  const texts = run.glyphs.map(() => '')
  const spans = new Map<number, ActualTextSpan>()
  const order: number[] = []
  // Clusters in the order their glyphs show, each glyph once.
  const clusters: Array<{ cluster: number; indices: number[] }> = []
  run.glyphs.forEach((glyph, index) => {
    const last = clusters.at(-1)
    if (last?.cluster === glyph.cluster) last.indices.push(index)
    else clusters.push({ cluster: glyph.cluster, indices: [index] })
  })
  const span = (indices: readonly number[], text: string) => {
    spans.set(order.length, { start: order.length, end: order.length + indices.length - 1, text })
    order.push(...indices)
  }
  if (!run.rtl) {
    const assigned = new Map<number, string>()
    for (const { cluster, indices } of clusters) {
      const text = clusterText(cluster)
      const widest = widestOf(indices)
      texts[widest] = text
      const glyph = run.glyphs[widest]?.glyph ?? -1
      // A glyph that stands for its cluster alone is read by its ToUnicode entry, letter by
      // letter as readers measure tracking; a cluster of several glyphs, or one whose glyph
      // already stands for other text, says what it spells.
      const known = font.glyphs.get(glyph)?.text ?? assigned.get(glyph)
      if (known === undefined) assigned.set(glyph, text)
      if (indices.length > 1 || (known !== undefined && known !== text)) span(indices, text)
      else order.push(...indices)
    }
    return { texts, order, spans }
  }
  for (const { cluster, indices } of clusters) {
    const text = shownMirrored(clusterText(cluster))
    const characters = Array.from(text)
    const marks = characters.filter((character) => MARK.test(character))
    const letterGlyphs = indices.filter((index) => advance(index) !== 0)
    const flat = indices.filter((index) => advance(index) === 0)
    // Each mark drawn as a glyph of its own stands for it, for readers without ActualText;
    // the marks are the flat glyphs shown last, nearest the letter in a right-to-left run.
    if (marks.length <= flat.length) {
      flat
        .slice(flat.length - marks.length)
        .toReversed()
        .forEach((index, place) => {
          texts[index] = marks[place] ?? ''
        })
    }
    const letters = characters.filter((character) => !MARK.test(character)).join('')
    const base = letterGlyphs.length > 0 ? letterGlyphs : indices
    texts[widestOf(base)] ||= letters || text
    span([...letterGlyphs, ...flat], text)
  }
  return { texts, order, spans }
}

/**
 * Content stream operators showing a run's glyphs, each where the shaper placed it: written in
 * one `TJ` per baseline, moved from where the glyph before it left the pen to its own place.
 * Each glyph stands for its characters in `font`'s ToUnicode map, which records the glyphs'
 * widths too, and spans of ActualText say what glyphs spell together.
 */
export function glyphRunOperators(
  run: PDFGlyphRun,
  font: PDFGlyphFont,
  placement: PDFGlyphRunPlacement
): string {
  const { face, size } = run
  const { texts, order, spans } = glyphTexts(run, font)
  const skew = face.syntheticItalic ? SKEW : 0
  const parts = [`q BT /${font.name} ${num(size)} Tf`]
  const color = placement.color
  if (color) parts.push(`${num(color[0])} ${num(color[1])} ${num(color[2])} rg`)
  const mode = placement.renderMode ?? 0
  if (face.syntheticBold && mode === 0) {
    const stroke = color ? `${num(color[0])} ${num(color[1])} ${num(color[2])} RG` : ''
    parts.push(`2 Tr ${num(size * 0.03)} w ${stroke}`.trim())
  } else if (mode !== 0) {
    parts.push(`${mode} Tr`)
  }
  parts.push(`1 0 ${num(skew)} 1 ${num(placement.x)} ${num(placement.y)} Tm`)
  // Where each glyph is drawn along the baseline, from the pen and its offset.
  const spaceExtra = placement.spaceExtra ?? 0
  const at: number[] = []
  let pen = 0
  run.glyphs.forEach((glyph, index) => {
    at.push(pen + glyph.offsetX)
    pen += glyph.advance + (spaceExtra && texts[index] === ' ' ? spaceExtra : 0)
  })
  const toUnits = (points: number) => num((-points * 1000) / size)
  let shown: string[] = []
  let rise = 0
  let current = 0
  let spanEnd = -1
  let spanRight = 0
  const widthOf = (index: number) => (face.glyphAdvance(run.glyphs[index].glyph) * size) / face.upem
  const flush = () => {
    if (shown.length) parts.push(`[${shown.join(' ')}] TJ`)
    shown = []
  }
  order.forEach((index, place) => {
    const glyph = run.glyphs[index]
    const text = texts[index] ?? ''
    const span = spans.get(place)
    if (span) {
      // Spans sit inside the text object, where the text matrix places them.
      flush()
      parts.push(`/Span << /ActualText <FEFF${utf16Hex(span.text)}> >> BDC`)
      spanEnd = span.end
      spanRight = Math.max(
        ...order
          .slice(span.start, span.end + 1)
          .map((member) => (at[member] ?? 0) + widthOf(member))
      )
    }
    const own = (face.glyphAdvance(glyph.glyph) * 1000) / face.upem
    const known = font.glyphs.get(glyph.glyph)
    if (!known || (!known.text && text)) {
      font.glyphs.set(glyph.glyph, { text: text || known?.text || '', width: own })
    }
    if (glyph.offsetY !== rise) {
      flush()
      rise = glyph.offsetY
      parts.push(`${num(rise)} Ts`)
    }
    const move = (at[index] ?? 0) - current
    if (Math.abs(move) > 0.0005) shown.push(toUnits(move))
    current = (at[index] ?? 0) + (own * size) / 1000
    // Readers measure a span from its first glyph to the end of its last; a mark or dot last
    // in it is spaced out to where its letter ends, so no gap opens before the next span.
    const reach = place === spanEnd ? spanRight - current : 0
    if (reach > 0.0005) {
      flush()
      parts.push(`${num(reach)} Tc`)
    }
    shown.push(`<${hex4(glyph.glyph)}>`)
    if (reach > 0.0005) {
      flush()
      parts.push('0 Tc')
      current += reach
    }
    if (place === spanEnd) {
      flush()
      parts.push('EMC')
    }
  })
  flush()
  if (rise) parts.push('0 Ts')
  // `q`…`Q` keeps a faked bold's render mode and stroke from the runs after it.
  parts.push('ET Q')
  return parts.join('\n')
}
