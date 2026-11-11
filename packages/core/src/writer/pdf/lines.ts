import { bidiLevels, visualOrder } from './bidi'
import type { InlineRun, ParagraphBlock, RunStyle } from './flow'
import { hasGlyph, shape, type Face, type FontSet, type ShapedGlyph } from './fonts'

/**
 * A paragraph broken into lines: its runs shaped by HarfBuzz in the faces that have their
 * characters, broken at spaces to fit the width (or anywhere in a word too long for a line), and
 * each line's pieces put in the order they show by the bidirectional algorithm.
 */

export interface GlyphPiece {
  kind: 'glyphs'
  face: Face
  /** The font size drawn, superscripts and subscripts already reduced. */
  size: number
  /** Points the baseline moves up for a superscript, down (negative) for a subscript. */
  rise: number
  style: RunStyle
  glyphs: ShapedGlyph[]
  /** The text the glyphs draw, which their clusters index, for copying text out of the PDF. */
  text: string
  width: number
  rtl: boolean
}

export interface ImagePiece {
  kind: 'image'
  src: string
  width: number
  height: number
  style: RunStyle
}

export type Piece = GlyphPiece | ImagePiece

export interface Line {
  /** In the order they show, left to right. */
  pieces: Piece[]
  width: number
  ascent: number
  descent: number
  height: number
  /** Spaces between words, which justified text widens. */
  spaces: number
  /** The paragraph's last line, or one ended by a line break, which justify leaves alone. */
  last: boolean
}

/** Resolves a page field to its text where the paragraph is laid out. */
export type FieldText = (field: 'pageNumber' | 'pageCount') => string

const SCRIPT_SCALE = 0.65
const OBJECT = '\uFFFC'

interface Item {
  start: number
  end: number
  style: RunStyle
  face: Face | null
  image: { src: string; width: number; height: number } | null
}

const sameStyle = (a: RunStyle, b: RunStyle) =>
  a === b ||
  (a.family === b.family &&
    a.size === b.size &&
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.strike === b.strike &&
    a.color === b.color &&
    a.background === b.background &&
    a.script === b.script &&
    a.link === b.link)

const isSpace = (char: string) => char === ' ' || char === '\t' || char === '\u00A0'

/** The faces the paragraph's text needs, loaded before it is laid out. */
export async function loadParagraphFaces(
  runs: readonly InlineRun[],
  fonts: FontSet
): Promise<void> {
  for (const run of runs) {
    const text = run.kind === 'text' ? run.text : '0123456789'
    await fonts.load(run.style.family, run.style.bold, run.style.italic, text)
    for (const fallback of fonts.fallbacks) {
      await fonts.load(fallback, run.style.bold, run.style.italic, text)
    }
  }
}

/** The face that draws `char` in `style`: its own family's, else the first fallback's. */
function faceFor(char: string, style: RunStyle, fonts: FontSet): Face | null {
  const own = fonts.loaded(style.family, style.bold, style.italic)
  if (own && hasGlyph(own, char)) return own
  for (const family of fonts.fallbacks) {
    const face = fonts.loaded(family, style.bold, style.italic)
    if (face && hasGlyph(face, char)) return face
  }
  return (
    own ??
    fonts.fallbacks.map((family) => fonts.loaded(family, style.bold, style.italic)).find(Boolean) ??
    null
  )
}

/** The paragraph's text, and its items split wherever the face drawing them changes. */
function itemsOf(runs: readonly InlineRun[], fonts: FontSet, field: FieldText) {
  let text = ''
  const items: Item[] = []
  for (const run of runs) {
    if (run.kind === 'image') {
      items.push({
        start: text.length,
        end: text.length + 1,
        style: run.style,
        face: null,
        image: run
      })
      text += OBJECT
      continue
    }
    const value = run.kind === 'field' ? field(run.field) : run.text
    for (const char of value) {
      const face = char === '\n' ? (items.at(-1)?.face ?? null) : faceFor(char, run.style, fonts)
      const last = items.at(-1)
      if (
        last &&
        !last.image &&
        sameStyle(last.style, run.style) &&
        last.face === face &&
        last.end === text.length
      ) {
        last.end += char.length
      } else
        items.push({
          start: text.length,
          end: text.length + char.length,
          style: run.style,
          face,
          image: null
        })
      text += char
    }
  }
  return { text, items }
}

const sizeOf = (style: RunStyle) => (style.script ? style.size * SCRIPT_SCALE : style.size)
const RISE = { super: 0.33, sub: -0.15 } as const
const riseOf = (style: RunStyle) => (style.script ? style.size * RISE[style.script] : 0)

/** A piece of `item` from `start` to `end`, shaped. */
function piece(text: string, item: Item, start: number, end: number, rtl: boolean): Piece | null {
  if (item.image) return { kind: 'image', ...item.image, style: item.style }
  const face = item.face
  const value = text.slice(start, end).replace(/\t/g, ' ')
  if (!face || !value) return null
  const size = sizeOf(item.style)
  const glyphs = shape(face, value, size, rtl)
  return {
    kind: 'glyphs',
    face,
    size,
    rise: riseOf(item.style),
    style: item.style,
    glyphs,
    text: value,
    width: glyphs.reduce((sum, glyph) => sum + glyph.advance, 0),
    rtl
  }
}

interface Segment {
  item: Item
  start: number
  end: number
  level: number
}

/** Splits items where the embedding level changes. */
function segmentsOf(items: readonly Item[], levels: Uint8Array): Segment[] {
  const segments: Segment[] = []
  for (const item of items) {
    let start = item.start
    for (let i = item.start + 1; i <= item.end; i += 1) {
      if (i === item.end || levels[i] !== levels[start]) {
        segments.push({ item, start, end: i, level: levels[start] ?? 0 })
        start = i
      }
    }
  }
  return segments
}

/** Each code unit's advance, from shaping each segment whole. */
function advancesOf(text: string, segments: readonly Segment[]): Float64Array {
  const advances = new Float64Array(text.length)
  for (const segment of segments) {
    const shaped = piece(text, segment.item, segment.start, segment.end, segment.level % 2 === 1)
    if (!shaped) continue
    if (shaped.kind === 'image') {
      advances[segment.start] = shaped.width
      continue
    }
    for (const glyph of shaped.glyphs) advances[segment.start + glyph.cluster] += glyph.advance
  }
  return advances
}

/** Where lines end: at a line break, or after the last space that lets the line fit. */
function breakLines(
  text: string,
  advances: Float64Array,
  width: number
): Array<[number, number, boolean]> {
  const lines: Array<[number, number, boolean]> = []
  let start = 0
  while (start < text.length) {
    let used = 0
    let lastBreak = -1
    let end = start
    let forced = false
    while (end < text.length) {
      const char = text[end] ?? ''
      if (char === '\n') {
        forced = true
        break
      }
      const next = used + (advances[end] ?? 0)
      if (next > width + 0.01 && !isSpace(char) && end > start) break
      used = next
      end += 1
      if (isSpace(char)) lastBreak = end
    }
    if (forced) {
      lines.push([start, end, true])
      start = end + 1
      continue
    }
    if (end < text.length && lastBreak > start) end = lastBreak
    if (end === start) end = start + 1
    lines.push([start, end, end >= text.length])
    start = end
  }
  if (!lines.length) lines.push([0, 0, true])
  return lines
}

/** The paragraph's lines at `width` points; faces must be loaded with `loadParagraphFaces`. */
export function layoutLines(
  block: ParagraphBlock,
  width: number,
  fonts: FontSet,
  field: FieldText
): Line[] {
  const { text, items } = itemsOf(block.runs, fonts, field)
  const levels = bidiLevels(text, block.rtl)
  const segments = segmentsOf(items, levels)
  const advances = advancesOf(text, segments)
  const emptySize = block.runs[0]?.style.size ?? 11
  const emptyFace = block.runs[0] ? faceFor(' ', block.runs[0].style, fonts) : null
  return breakLines(text, advances, width).map(([start, end, last]) => {
    let trimmed = end
    while (trimmed > start && isSpace(text[trimmed - 1] ?? '')) trimmed -= 1
    const parts = segments
      .filter((segment) => segment.end > start && segment.start < trimmed)
      .map((segment) => ({
        segment,
        from: Math.max(start, segment.start),
        to: Math.min(trimmed, segment.end)
      }))
    const order = visualOrder(parts.map((part) => part.segment.level))
    const pieces = order.flatMap((index) => {
      const part = parts.at(index)
      if (!part) return []
      const shaped = piece(
        text,
        part.segment.item,
        part.from,
        part.to,
        part.segment.level % 2 === 1
      )
      return shaped ? [shaped] : []
    })
    let ascent = 0
    let descent = 0
    let height = 0
    for (const shaped of pieces) {
      if (shaped.kind === 'image') {
        ascent = Math.max(ascent, shaped.height)
        height = Math.max(height, shaped.height)
        continue
      }
      const size = shaped.style.size
      ascent = Math.max(
        ascent,
        (size * shaped.face.ascender) / shaped.face.upem + Math.max(0, shaped.rise)
      )
      descent = Math.max(descent, (-size * shaped.face.descender) / shaped.face.upem)
      height = Math.max(height, size * block.leading)
    }
    if (!pieces.length && emptyFace) {
      ascent = (emptySize * emptyFace.ascender) / emptyFace.upem
      descent = (-emptySize * emptyFace.descender) / emptyFace.upem
    }
    if (!height) height = emptySize * block.leading
    height = Math.max(height, ascent + descent)
    const spaces = Array.from(text.slice(start, trimmed)).filter((char) => char === ' ').length
    return {
      pieces,
      width: pieces.reduce((sum, shaped) => sum + shaped.width, 0),
      ascent,
      descent,
      height,
      spaces,
      last
    }
  })
}
