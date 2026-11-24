import type { PDFFontFace } from './font-name'
import { isRightToLeft, logicalOrder, normalizeGlyphText } from './logical'

/**
 * Live text from a page's text-showing operators. Each glyph is placed as PDF viewers place it,
 * from the text state (matrix, font size, character and word spacing, horizontal scale, rise), so
 * text keeps the exact baseline, size, tracking and direction it was drawn with, wherever the
 * PDF's own text extraction would join or split it differently. Glyphs on one baseline in one
 * face and paint become one text layer.
 */

export type Matrix = [number, number, number, number, number, number]

export const multiply = (a: Matrix, b: Matrix): Matrix => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5]
]

export const n = (value: number) => String(Math.round(value * 1000) / 1000)
export const matrixAttr = (m: Matrix) => `matrix(${m.map(n).join(' ')})`
export const escapeXML = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** The paint text is shown with, as SVG attributes, and what it groups and clips under. */
export interface TextPaint {
  /** SVG paint attributes, such as ` fill="#ff0000"`. */
  attrs: string
  /** The containers (layers, clips) the text is drawn in, outermost first. */
  chain: readonly string[]
}

/** What pdf.js tells of a loaded font. */
export interface PDFFontInfo {
  face: PDFFontFace | null
  fallback: string
  /** Glyph space to text space; 1/1000 for all but Type 3 fonts. */
  fontMatrix: Matrix
  vertical: boolean
}

interface Glyph {
  text: string
  /** Distance along the run's baseline from its origin, and across it (down), in page units. */
  u: number
  v: number
  advance: number
  mark: boolean
  font: PDFFontInfo
  /** The ActualText span the glyph is in: its glyphs spell the span's text together. */
  span: Span | null
}

interface Span {
  text: string
}

interface Run {
  key: string
  origin: [number, number]
  /** Unit baseline direction and the direction down from it, in page space. */
  along: [number, number]
  down: [number, number]
  size: number
  /** Drawn leaning, as PDF writers draw italic in a face without one. */
  slanted: boolean
  paint: TextPaint
  glyphs: Glyph[]
}

/** A glyph one operator showed: its characters, where it is drawn, and its advance. */
interface Shown {
  unicode: string
  at: Matrix
  advance: number
}

function expectRun(run: Run | null): Run {
  if (!run) throw new Error('No text run is open')
  return run
}

interface Cluster {
  text: string
  left: number
  right: number
  font: PDFFontInfo
  span: Span | null
}

const MARK = /^\p{M}+$/u
/** How far a glyph may sit off the run's baseline, and jump ahead along it, in ems. */
const BASELINE_TOLERANCE = 0.08
const MAX_GAP = 3
const MARK_REACH = 1.5
/** Page units within which a mark's origin is on a letter's edge. */
const EPSILON = 0.01

function faceAttrs(font: PDFFontInfo): string {
  const { face, fallback } = font
  const family = face ? `${face.family}, ${fallback}` : fallback
  const weight = face && face.weight !== 400 ? ` font-weight="${face.weight}"` : ''
  const italic = face?.italic ? ' font-style="italic"' : ''
  return ` font-family="${escapeXML(family.replace(/"/g, ''))}"${weight}${italic}`
}

/**
 * The spacing most letters were set apart by: the commonest gap between them. Kerned pairs are
 * set apart by more or less, and the font kerns them again where the text is laid out.
 */
function commonGap(gaps: number[], size: number): number {
  const counts = new Map<number, number[]>()
  for (const gap of gaps) {
    const bucket = Math.round(gap / (0.005 * size))
    counts.set(bucket, [...(counts.get(bucket) ?? []), gap])
  }
  let best: number[] = []
  for (const members of counts.values()) if (members.length > best.length) best = members
  return best.length > 0 ? best.reduce((sum, gap) => sum + gap, 0) / best.length : 0
}

/** Glyphs as clusters left to right: a letter with its marks, or an ActualText span's glyphs. */
function clusters(glyphs: Glyph[]): Cluster[] {
  const bases: Cluster[] = []
  for (const glyph of glyphs) {
    if (glyph.mark) continue
    const last = bases.at(-1)
    // Glyphs of one ActualText span spell its text once.
    if (glyph.span && last?.span === glyph.span) {
      last.left = Math.min(last.left, glyph.u)
      last.right = Math.max(last.right, glyph.u + glyph.advance)
      continue
    }
    bases.push({
      text: glyph.span ? glyph.span.text : glyph.text,
      left: glyph.u,
      right: glyph.u + glyph.advance,
      font: glyph.font,
      span: glyph.span
    })
  }
  const centre = (cluster: Cluster) => (cluster.left + cluster.right) / 2
  // A mark belongs to the letter it sits on, unless its span already spelled it: the letter whose
  // box holds the mark's origin, which writers put at the letter's start in right-to-left text
  // and at its end in left-to-right text, or else the letter nearest it.
  const rtl = bases.some((base) => isRightToLeft(base.text))
  const letters = bases.filter((base) => base.text.trim())
  for (const glyph of glyphs) {
    if (!glyph.mark) continue
    const origin = glyph.u
    const at = glyph.u + glyph.advance / 2
    const holds = (base: Cluster) =>
      rtl
        ? base.left - EPSILON <= origin && origin < base.right - EPSILON
        : base.left + EPSILON < origin && origin <= base.right + EPSILON
    const owner =
      (glyph.span && bases.find((base) => base.span === glyph.span)) ??
      letters.find(holds) ??
      letters.reduce<Cluster | null>(
        (best, base) =>
          !best || Math.abs(centre(base) - at) < Math.abs(centre(best) - at) ? base : best,
        null
      )
    if (!owner)
      bases.push({ text: glyph.text, left: glyph.u, right: glyph.u, font: glyph.font, span: null })
    else if (!owner.span) owner.text += glyph.text
  }
  return bases.sort((a, b) => a.left - b.left)
}

/** Builds text runs from glyphs as the walker shows them, and writes each as an SVG `<text>`. */
export class TextCollector {
  private run: Run | null = null
  private readonly spans: (Span | null)[] = []

  constructor(private readonly emit: (markup: string, chain: readonly string[]) => void) {}

  /** A marked-content sequence opens; an ActualText span covers the glyphs inside it. */
  beginMarked(actualText: string | null): void {
    this.spans.push(actualText === null ? null : { text: normalizeGlyphText(actualText) })
  }

  endMarked(): void {
    this.spans.pop()
  }

  private span(): Span | null {
    for (let i = this.spans.length - 1; i >= 0; i--) {
      const span = this.spans[i]
      if (span) return span
    }
    return null
  }

  /**
   * Glyphs shown at `matrix` (the CTM times the text matrix, moved to the current point and
   * raised), `size` the font size and `hScale` the horizontal scale; returns the advance in text
   * space, which moves the current point.
   */
  show(
    glyphs: readonly unknown[],
    state: {
      matrix: Matrix
      size: number
      hScale: number
      charSpacing: number
      wordSpacing: number
      rise: number
      font: PDFFontInfo
      paint: TextPaint
    }
  ): number {
    const { size, font, hScale } = state
    const direction = size < 0 ? -1 : 1
    const widthScale = size * font.fontMatrix[0]
    // A font's em is the font size, Type 3 fonts' too, whatever their glyph space.
    const emScale = Math.abs(size)
    let x = 0
    const shown: Shown[] = []
    for (const glyph of glyphs) {
      if (typeof glyph === 'number') {
        x -= (glyph * size) / 1000
        continue
      }
      if (typeof glyph !== 'object' || glyph === null) continue
      const unicode = Reflect.get(glyph, 'unicode')
      const width = Reflect.get(glyph, 'width')
      const isSpace = Reflect.get(glyph, 'isSpace') === true
      const advance =
        (typeof width === 'number' ? width : 0) * widthScale +
        ((isSpace ? state.wordSpacing : 0) + state.charSpacing) * direction
      if (!font.vertical && typeof unicode === 'string') {
        shown.push({
          unicode,
          at: multiply(state.matrix, [1, 0, 0, 1, x * hScale, state.rise]),
          // The glyph's own width, unstretched: live text has no horizontal scale, so the room
          // a stretch adds between letters becomes tracking and the text keeps its length.
          advance: (typeof width === 'number' ? width : 0) * widthScale
        })
      }
      x += advance
    }
    this.add(shown, emScale, state)
    return x * hScale
  }

  /**
   * The glyphs one operator showed, to the open run when they continue its line, otherwise as a
   * new run. They are judged together, so a word shown left of the line, as a right-to-left line
   * written word by word is, joins the line by where it ends.
   */
  private add(shown: Shown[], em: number, state: { font: PDFFontInfo; paint: TextPaint }): void {
    const first = shown.at(0)
    if (!first) return
    const { at } = first
    const scaleAlong = Math.hypot(at[0], at[1])
    if (!(scaleAlong > 0)) return
    const along: [number, number] = [at[0] / scaleAlong, at[1] / scaleAlong]
    // SVG text's second axis points down from the baseline, square to it: text space points up,
    // and a slanted text matrix (synthetic italic) leans its glyphs without moving its baseline.
    const across = (along[0] * at[3] - along[1] * at[2]) * -1
    const down: [number, number] = across >= 0 ? [-along[1], along[0]] : [along[1], -along[0]]
    const size = em * Math.abs(across)
    if (!(size > 0)) return
    const slanted = (at[2] * along[0] + at[3] * along[1]) / Math.abs(across) > 0.1
    const span = this.span()
    const key = `${state.paint.attrs}|${state.paint.chain.join(',')}|${slanted}`
    const glyphs = shown.flatMap(({ unicode, at: glyphAt, advance: advanceText }) => {
      const text = normalizeGlyphText(unicode)
      if (!text && !span) return []
      const advance = advanceText * scaleAlong
      const mark = advance < 0.01 * size || MARK.test(text)
      return [{ text, at: glyphAt, advance, mark, font: state.font, span }]
    })
    if (glyphs.length === 0) return
    const fits = this.run !== null && this.fits(this.run, key, along, down, size, glyphs)
    if (!fits) {
      this.flush()
      this.run = {
        key,
        origin: [at[4], at[5]],
        along,
        down,
        size,
        slanted,
        paint: state.paint,
        glyphs: []
      }
    }
    const run = expectRun(this.run)
    for (const { at: glyphAt, ...glyph } of glyphs) {
      const dx = glyphAt[4] - run.origin[0]
      const dy = glyphAt[5] - run.origin[1]
      run.glyphs.push({
        ...glyph,
        u: dx * run.along[0] + dy * run.along[1],
        v: dx * run.down[0] + dy * run.down[1]
      })
    }
  }

  private fits(
    run: Run,
    key: string,
    along: [number, number],
    down: [number, number],
    size: number,
    glyphs: { at: Matrix; advance: number; mark: boolean }[]
  ): boolean {
    if (run.key !== key) return false
    if (Math.abs(size - run.size) > 0.02 * run.size) return false
    const sameAxes =
      Math.abs(along[0] - run.along[0]) < 1e-3 &&
      Math.abs(along[1] - run.along[1]) < 1e-3 &&
      Math.abs(down[0] - run.down[0]) < 1e-3 &&
      Math.abs(down[1] - run.down[1]) < 1e-3
    if (!sameAxes) return false
    const placed = glyphs.map(({ at, advance, mark }) => {
      const dx = at[4] - run.origin[0]
      const dy = at[5] - run.origin[1]
      const u = (dx * run.along[0] + dy * run.along[1]) / size
      return { u, end: u + advance / size, v: (dx * run.down[0] + dy * run.down[1]) / size, mark }
    })
    const letters = placed.filter((glyph) => !glyph.mark)
    const bases = run.glyphs.filter((glyph) => !glyph.mark)
    const start = Math.min(...bases.map((glyph) => glyph.u), 0) / size
    const end = Math.max(...run.glyphs.map((glyph) => glyph.u + glyph.advance)) / size
    if (letters.length === 0) {
      return placed.every(
        (glyph) =>
          Math.abs(glyph.v) < MARK_REACH &&
          glyph.u > start - MARK_REACH &&
          glyph.u < end + MARK_REACH
      )
    }
    // Words may come in either order along the line, as right-to-left text often does.
    const from = Math.min(...letters.map((glyph) => glyph.u))
    const to = Math.max(...letters.map((glyph) => glyph.end))
    return (
      Math.abs(letters[0].v) < BASELINE_TOLERANCE && to > start - MAX_GAP && from < end + MAX_GAP
    )
  }

  /** Writes the open run, before anything else is drawn over it. */
  flush(): void {
    const run = this.run
    this.run = null
    if (!run) return
    const markup = runMarkup(run)
    if (markup) this.emit(markup, run.paint.chain)
  }
}

/** The gap letters were set apart by, as tracking, when it is more than rounding. */
function runTracking(parts: Cluster[], size: number): number {
  const gaps: number[] = []
  for (let i = 1; i < parts.length; i++) {
    if (parts[i].text.trim() && parts[i - 1].text.trim())
      gaps.push(parts[i].left - parts[i - 1].right)
  }
  const tracking = commonGap(gaps, size)
  return Math.abs(tracking) > 0.01 * size ? tracking : 0
}

/**
 * Clusters in logical order, with a space where the PDF moved past a word gap rather than
 * showing one, and without spaces at either end, which are not drawn and would move the anchor.
 */
function orderedClusters(parts: Cluster[], letterSpacing: number, size: number): Cluster[] {
  const visual: Cluster[] = []
  for (const [i, part] of parts.entries()) {
    const previous = i > 0 ? parts[i - 1] : null
    const gap = previous ? part.left - previous.right - letterSpacing : 0
    if (previous && part.text.trim() && previous.text.trim() && gap > 0.2 * size)
      visual.push({ ...previous, text: ' ', span: null })
    visual.push(part)
  }
  const ordered = logicalOrder(visual)
  while (ordered.length > 0 && !ordered[0].text.trim()) ordered.shift()
  while (ordered.length > 0 && !ordered.at(-1)?.text.trim()) ordered.pop()
  return ordered
}

/** The text's characters, the first cluster's face being the text's and others `<tspan>`s. */
function textContent(ordered: Cluster[], base: string): string {
  const spans: string[] = []
  let current = base
  let chunk = ''
  const close = () => {
    if (!chunk) return
    spans.push(current === base ? escapeXML(chunk) : `<tspan${current}>${escapeXML(chunk)}</tspan>`)
    chunk = ''
  }
  for (const part of ordered) {
    const face = part.text.trim() ? faceAttrs(part.font) : current
    if (face !== current) {
      close()
      current = face
    }
    chunk += part.text
  }
  close()
  return spans.join('')
}

/**
 * A run as one `<text>`: its characters in logical order, a `<tspan>` per face, the tracking its
 * glyphs were set with, and words apart where the PDF moved past a gap rather than showing a
 * space. Right-to-left text anchors at its right edge, where it starts, so it keeps its place in
 * a font of other widths.
 */
function runMarkup(run: Run): string | null {
  const parts = clusters(run.glyphs)
  const letters = parts.filter((part) => part.text.trim())
  if (letters.length === 0) return null
  const letterSpacing = runTracking(parts, run.size)
  const ordered = orderedClusters(parts, letterSpacing, run.size)
  if (ordered.length === 0) return null
  const text = ordered.map((part) => part.text).join('')
  const left = letters[0].left
  // The tracking after the last letter is not part of the text's drawn width.
  const right = letters.at(-1)?.right ?? left
  const rtl = isRightToLeft(text)
  const anchorU = rtl ? right : left
  const m: Matrix = [
    run.along[0],
    run.along[1],
    run.down[0],
    run.down[1],
    run.origin[0] + anchorU * run.along[0],
    run.origin[1] + anchorU * run.along[1]
  ]
  const base = faceAttrs(ordered[0].font)
  const italic = run.slanted && !base.includes('font-style') ? ' font-style="italic"' : ''
  const spacing = letterSpacing ? ` letter-spacing="${n(letterSpacing)}"` : ''
  // The length the PDF drew the text at, which sizes the layer until its fonts can measure it.
  const length = ` textLength="${n(right - left + letterSpacing)}"`
  const anchor = rtl ? ' text-anchor="end" direction="rtl"' : ''
  return `<text transform="${matrixAttr(m)}" font-size="${n(run.size)}"${base}${italic}${spacing}${length}${anchor}${run.paint.attrs}>${textContent(ordered, base)}</text>`
}
