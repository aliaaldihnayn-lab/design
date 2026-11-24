import { PDFDict, PDFDocument, PDFName } from '@cantoo/pdf-lib'
import { uniq } from 'es-toolkit'

import type { Fill, SceneNode } from '@lawha/scene-graph'

import type { LaidOutGlyph } from '#core/canvas/text/placed'
import type { PlacedText } from '#core/canvas/text/shape'
import { svg, type SVGNode, type SVGPaint, type SVGTextDrawer } from '#core/io/formats/svg'
import { styleRunAt } from '#core/text/character-face'
import { EMOJI_METRICS_FAMILY } from '#core/text/emoji'
import type { GlyphSourceFile } from '#core/text/font/glyphs'
import { fontInstance, harfBuzzFont, type OutlineCommand } from '#core/text/font/harfbuzz'
import { fontInstanceVariations, staticFontInstance } from '#core/text/font/instance'
import { fontManager } from '#core/text/font/manager'

import {
  glyphFaceMetrics,
  glyphRunOperators,
  num,
  PDFGlyphFonts,
  type PDFGlyphFace,
  type PDFGlyphRun,
  type PDFRunGlyph
} from './glyphs'

/**
 * Design text in a PDF as the canvas draws it: the glyphs the canvas laid out, by their IDs in
 * the font files it drew them from, each at the place it drew it, so Arabic keeps its forms and
 * marks and Latin its kerning. The text is real text in embedded fonts, with ActualText and a
 * ToUnicode map, so it selects, searches and copies as written.
 *
 * The rest of the page is drawn by svg2pdf, so a text layer goes in as a placeholder `<text>`
 * whose content names its glyphs; svg2pdf sets its transform, clip and opacity and asks jsPDF to
 * write it, and {@link PDFGlyphText.operators} writes the glyphs instead. A paint text cannot be
 * filled with, such as a gradient, and strokes are drawn as the glyphs' outlines, under a
 * placeholder that shows nothing and keeps the text selectable.
 */

/** The content of a placeholder `<text>`. */
const MARKER = /^LawhaGlyphs(\d+)$/

/** The resource names the fonts take, apart from jsPDF's own `F1`, `F2`… */
const FONT_PREFIX = 'LawhaF'

/** Fill, or draw nothing and stay selectable. */
const RENDER_FILL = 0
const RENDER_INVISIBLE = 3

interface DesignFace extends PDFGlyphFace {
  variations: GlyphSourceFile['variations']
  /** The face as an export report names it, such as `Inter Bold (wght 700)`. */
  label: string
}

/** A run of glyphs, where its pen starts in the layer. */
interface PlacedRun {
  run: PDFGlyphRun
  x: number
  y: number
}

interface Marker {
  runs: PlacedRun[]
  color: [number, number, number] | null
  renderMode: number
}

/** A glyph to draw, with the face its file is embedded as. */
interface DrawnGlyph {
  glyph: LaidOutGlyph
  face: DesignFace
}

const fileKey = (file: GlyphSourceFile) =>
  [
    file.family,
    file.style,
    file.file,
    ...file.variations.map(({ axis, value }) => `${axis}=${value}`)
  ].join('\0')

function faceLabel(file: GlyphSourceFile, variations: GlyphSourceFile['variations']): string {
  const name = file.file
    ? `${file.family} ${file.style} (file ${file.file + 1})`
    : `${file.family} ${file.style}`
  const axes = variations.map(({ axis, value }) => `${axis} ${value}`).join(', ')
  return axes ? `${name} (${axes})` : name
}

const postScriptName = (file: GlyphSourceFile) =>
  `${file.family}-${file.style}`.replace(/[^A-Za-z0-9-]/g, '') || 'Font'

function fileBytes(file: GlyphSourceFile): ArrayBuffer | null {
  if (file.file === 0) return fontManager.loadedData(file.family, file.style)
  return fontManager.shardData(file.family, file.style)[file.file - 1] ?? null
}

const point = (value: number | undefined, offset: number) => num((value ?? 0) + offset)

/** A glyph's outline as SVG path data, its origin at `x`, `y`. */
function outlinePath(commands: readonly OutlineCommand[], x: number, y: number): string {
  return commands
    .map((command) => {
      const points: string[] = []
      if (command.x1 !== undefined) points.push(point(command.x1, x), point(command.y1, y))
      if (command.x2 !== undefined) points.push(point(command.x2, x), point(command.y2, y))
      if (command.x !== undefined) points.push(point(command.x, x), point(command.y, y))
      return `${command.type}${points.join(' ')}`
    })
    .join('')
}

/** The `fill-opacity` a style run's own colour is drawn with, none when it is opaque. */
const runOpacity = (alpha: number) => (alpha < 1 ? num(alpha) : undefined)

/** A solid paint's colour and alpha, or null for any other paint. */
function solidColor(
  fill: Fill | undefined
): { rgb: [number, number, number]; alpha: number } | null {
  if (!fill?.visible || fill.type !== 'SOLID') return null
  return { rgb: [fill.color.r, fill.color.g, fill.color.b], alpha: fill.color.a * fill.opacity }
}

export class PDFGlyphText {
  readonly fonts: PDFGlyphFonts
  private readonly markers: Marker[] = []
  private readonly faces = new Map<string, DesignFace | null>()
  private clips = 0

  constructor(private readonly place: (node: SceneNode) => PlacedText | null) {
    this.fonts = new PDFGlyphFonts({
      prefix: FONT_PREFIX,
      subset: (face, glyphs) => {
        const variations = this.faceVariations(face.key)
        return staticFontInstance(face.bytes, variations, glyphs).catch(() => null)
      }
    })
  }

  private faceVariations(key: string): GlyphSourceFile['variations'] {
    return this.faces.get(key)?.variations ?? []
  }

  /** The face drawing a file's glyphs, read the first time it is asked for. */
  private face(file: GlyphSourceFile): DesignFace | null {
    const key = fileKey(file)
    const known = this.faces.get(key)
    if (known !== undefined) return known
    const bytes = fileBytes(file)
    const parsed = bytes ? harfBuzzFont(bytes) : null
    let face: DesignFace | null = null
    if (bytes && parsed) {
      const variations = fontInstanceVariations(bytes, file.variations)
      const instance = fontInstance(parsed, variations)
      const italic = /italic|oblique/i.test(file.style)
      face = {
        key,
        name: postScriptName(file),
        bytes,
        upem: parsed.face.upem,
        ...glyphFaceMetrics(bytes, parsed.face.upem),
        bold: /bold|black|heavy/i.test(file.style),
        italic,
        syntheticBold: false,
        syntheticItalic: false,
        glyphAdvance: (glyph) => instance.font.glyphHAdvance(glyph),
        variations,
        label: faceLabel(file, variations)
      }
    }
    this.faces.set(key, face)
    return face
  }

  /**
   * The glyphs of placed text to draw, each with its face, or null when one is drawn from a font
   * whose file cannot be embedded, so the text is written as SVG text instead. Emoji the canvas
   * draws as images over a blank square are left out.
   */
  private drawnGlyphs(placed: PlacedText): DrawnGlyph[] | null {
    const drawn: DrawnGlyph[] = []
    for (const glyph of placed.glyphs) {
      const file = glyph.source?.file
      if (!file) return null
      if (file.family === EMOJI_METRICS_FAMILY) continue
      const face = this.face(file)
      if (!face) return null
      drawn.push({ glyph, face })
    }
    return drawn
  }

  /** Draws a text layer's glyphs; see {@link SVGTextDrawer}. */
  readonly drawer: SVGTextDrawer = (node, paint) => {
    const placed = this.place(node)
    if (!placed) return null
    const drawn = this.drawnGlyphs(placed)
    if (!drawn) return null
    const out: SVGNode[] = []
    const fills = node.fills.filter((fill) => fill.visible)
    const primary = fills.findIndex((fill) => fill.type === 'SOLID')
    for (const [index, fill] of fills.entries()) {
      if (index === primary) out.push(...this.textMarkers(node, placed, drawn, fill, paint(fill)))
      else out.push(...outlineElements(drawn, paint(fill)))
      out.push(...decorationElements(placed, paint(fill)))
    }
    out.push(...strokeElements(node, drawn, paint, () => `lawha-text-clip${this.clips++}`))
    // Text painted only in outlines stays selectable and searchable, drawn invisibly over them.
    if (primary === -1) {
      out.push(this.marker(runsOf(placed, drawn), null, RENDER_INVISIBLE, { color: '#000' }))
    }
    return out
  }

  /** The placeholders of the text filled in a solid colour, one per colour its style runs set. */
  private textMarkers(
    node: SceneNode,
    placed: PlacedText,
    drawn: readonly DrawnGlyph[],
    fill: Fill,
    paint: SVGPaint
  ): SVGNode[] {
    const layer = solidColor(fill)
    const sameText = placed.text === node.text
    const colorOf = (glyph: LaidOutGlyph) => {
      const character = glyph.firstCharacter
      const run = sameText && character !== undefined ? styleRunAt(node, character) : undefined
      return solidColor(run?.style.fills?.find((paint) => paint.visible)) ?? layer
    }
    const groups = new Map<string, { color: ReturnType<typeof colorOf>; glyphs: Set<number> }>()
    for (const [index, { glyph }] of drawn.entries()) {
      const color = colorOf(glyph)
      const key = color ? `${color.rgb.join(',')}/${color.alpha}` : ''
      let group = groups.get(key)
      if (!group) {
        group = { color, glyphs: new Set() }
        groups.set(key, group)
      }
      group.glyphs.add(index)
    }
    return [...groups.values()].map(({ color, glyphs }) => {
      const alpha = color?.alpha ?? 1
      return this.marker(
        runsOf(placed, drawn, (index) => glyphs.has(index)),
        color?.rgb ?? null,
        RENDER_FILL,
        {
          color: paint.color ?? '#000',
          opacity: color === layer ? paint.opacity : runOpacity(alpha)
        }
      )
    })
  }

  private marker(
    runs: PlacedRun[],
    color: [number, number, number] | null,
    renderMode: number,
    paint: { color: string; opacity?: number | string }
  ): SVGNode {
    const id = this.markers.push({ runs, color, renderMode }) - 1
    return svg(
      'text',
      { x: 0, y: 0, 'font-size': 1, fill: paint.color, 'fill-opacity': paint.opacity },
      `LawhaGlyphs${id}`
    )
  }

  /**
   * The content a placeholder stands for, drawn in the layer's space that `matrix` (SVG's
   * `a b c d e f`) and `x`, `y` place on the page; null for text that is no placeholder.
   */
  operators(text: string, matrix: readonly number[], x: number, y: number): string | null {
    const match = MARKER.exec(text)
    const marker = match ? this.markers.at(Number(match[1])) : undefined
    if (!marker) return null
    // The layer's space turned y up, as text readers expect text space to be: text drawn with
    // y running down reads to them as upside down, out of order.
    const parts = [`q ${matrix.map(num).join(' ')} cm 1 0 0 -1 ${num(x)} ${num(y)} cm`]
    for (const placed of marker.runs) {
      parts.push(
        glyphRunOperators(placed.run, this.fonts.use(placed.run.face), {
          x: placed.x,
          y: -placed.y,
          color: marker.color,
          renderMode: marker.renderMode
        })
      )
    }
    parts.push('Q')
    return parts.join('\n')
  }

  /** The faces text was drawn in, as an export report names them. */
  embeddedFaces(): string[] {
    return this.fonts.faces().flatMap((face) => this.faces.get(face.key)?.label ?? [])
  }

  /** Writes the fonts the glyphs were drawn in into the PDF jsPDF made, and names them on its pages. */
  async embed(data: Uint8Array): Promise<Uint8Array> {
    if (this.fonts.size === 0) return data
    const pdf = await PDFDocument.load(data, { updateMetadata: false })
    const refs = await this.fonts.write(pdf)
    // jsPDF's pages share one resource dictionary, which print conversion finds by reference:
    // the fonts go into it, rather than into a copy on each page.
    const fontDicts = new Set<PDFDict>()
    for (const page of pdf.getPages()) {
      const resources = page.node.lookupMaybe(PDFName.of('Resources'), PDFDict)
      if (!resources) continue
      let fonts = resources.lookupMaybe(PDFName.of('Font'), PDFDict)
      if (!fonts) {
        fonts = pdf.context.obj({})
        resources.set(PDFName.of('Font'), fonts)
      }
      fontDicts.add(fonts)
    }
    for (const fonts of fontDicts) {
      for (const [name, ref] of refs) fonts.set(PDFName.of(name), ref)
    }
    return pdf.save({ useObjectStreams: false })
  }
}

/**
 * The glyphs `include` keeps, cut into runs of one face, size and baseline that follow each other
 * in drawing order, each with the characters it stands for.
 */
function runsOf(
  placed: PlacedText,
  drawn: readonly DrawnGlyph[],
  include: (index: number) => boolean = () => true
): PlacedRun[] {
  const starts = uniq(placed.glyphs.flatMap((glyph) => glyph.firstCharacter ?? [])).sort(
    (a, b) => a - b
  )
  const endOf = (character: number) =>
    starts.find((start) => start > character) ?? placed.text.length
  const runs: PlacedRun[] = []
  let current: DrawnGlyph[] = []
  let last = -2
  const flush = () => {
    if (current.length > 0) runs.push(placedRun(placed.text, current, endOf))
    current = []
  }
  for (const [index, entry] of drawn.entries()) {
    if (!include(index)) continue
    const previous = current.at(-1)
    const joins =
      previous &&
      last === index - 1 &&
      previous.glyph.run === entry.glyph.run &&
      previous.face === entry.face &&
      previous.glyph.fontSize === entry.glyph.fontSize &&
      previous.glyph.baseline === entry.glyph.baseline
    if (!joins) flush()
    current.push(entry)
    last = index
  }
  flush()
  return runs
}

/** Combining marks, which a shaper may give clusters of their own. */
const COMBINING = /\p{M}/u

/**
 * The letter a character belongs to: itself, or for a mark the letter before it, so a mark the
 * shaper drew apart reads with its letter, as one cluster.
 */
function letterOf(text: string, character: number, start: number): number {
  let index = character
  while (index > start && COMBINING.test(text[index] ?? '')) index--
  return index
}

function placedRun(
  text: string,
  glyphs: readonly DrawnGlyph[],
  endOf: (character: number) => number
): PlacedRun {
  const characters = glyphs.flatMap(({ glyph }) => glyph.firstCharacter ?? [])
  const start = characters.length > 0 ? Math.min(...characters) : 0
  let end = characters.length > 0 ? endOf(Math.max(...characters)) : 0
  // Breaks and the spaces a wrapped line hangs past its end are drawn by no glyph of it.
  const drawn = new Set(characters)
  while (end > start && !drawn.has(end - 1) && /\s/.test(text[end - 1] ?? '')) end--
  const first = glyphs[0].glyph
  const face = glyphs[0].face
  // The pen moves from letter to letter; a mark, which advances nothing, is drawn off the pen at
  // the letter it sits on, as a shaper places it, so readers see each letter where it is.
  const pens: number[] = []
  let pen: number | null = null
  for (let index = glyphs.length - 1; index >= 0; index--) {
    const { glyph } = glyphs[index]
    if (face.glyphAdvance(glyph.id) !== 0 || pen === null) pen = glyph.x
    pens[index] = pen
  }
  let cluster = 0
  const runGlyphs: PDFRunGlyph[] = glyphs.map(({ glyph }, index) => {
    if (glyph.firstCharacter !== undefined)
      cluster = letterOf(text, glyph.firstCharacter, start) - start
    const next = pens.at(index + 1)
    return {
      glyph: glyph.id,
      cluster,
      advance: next === undefined ? glyph.advance : next - pens[index],
      offsetX: glyph.x - pens[index],
      offsetY: glyph.baseline - glyph.y
    }
  })
  const runText = text.slice(start, end)
  const rtl = first.run.rtl
  return {
    run: { face: glyphs[0].face, size: first.fontSize, text: runText, glyphs: runGlyphs, rtl },
    x: pens[0] ?? first.x,
    y: first.baseline
  }
}

/** The outlines of every glyph drawn, as one path's data. */
function glyphOutlines(drawn: readonly DrawnGlyph[]): string {
  return drawn
    .map(({ glyph }) => {
      const commands = glyph.source?.outline(glyph.id, glyph.fontSize)
      return commands ? outlinePath(commands, glyph.x, glyph.y) : ''
    })
    .join('')
}

function paintAttrs(paint: SVGPaint, key: 'fill' | 'stroke') {
  return { [key]: paint.color ?? 'none', [`${key}-opacity`]: paint.opacity }
}

function outlineElements(drawn: readonly DrawnGlyph[], paint: SVGPaint): SVGNode[] {
  const d = glyphOutlines(drawn)
  return d && paint.color ? [svg('path', { d, ...paintAttrs(paint, 'fill') })] : []
}

function decorationElements(placed: PlacedText, paint: SVGPaint): SVGNode[] {
  if (placed.decorations.length === 0 || !paint.color) return []
  const d = placed.decorations
    .map(
      (rect) =>
        `M${num(rect.x)} ${num(rect.y)}h${num(rect.width)}v${num(rect.height)}h${num(-rect.width)}Z`
    )
    .join('')
  return [svg('path', { d, ...paintAttrs(paint, 'fill') })]
}

/**
 * Strokes on the glyphs' outlines, centred, or inside or outside them as the canvas draws them:
 * twice as wide, clipped to the outlines or to everything around them.
 */
function strokeElements(
  node: SceneNode,
  drawn: readonly DrawnGlyph[],
  paint: (fill: Fill) => SVGPaint,
  clipId: () => string
): SVGNode[] {
  const strokes = node.strokes.filter((stroke) => stroke.visible && stroke.weight > 0)
  if (strokes.length === 0) return []
  const d = glyphOutlines(drawn)
  if (!d) return []
  return strokes.flatMap((stroke) => {
    const painted = paint(stroke)
    if (!painted.color) return []
    const aligned = stroke.align !== 'CENTER'
    const id = aligned ? clipId() : undefined
    const path = svg('path', {
      d,
      fill: 'none',
      ...paintAttrs(painted, 'stroke'),
      'stroke-width': num(aligned ? stroke.weight * 2 : stroke.weight),
      'stroke-linejoin': stroke.join?.toLowerCase(),
      'stroke-dasharray': stroke.dashPattern?.length ? stroke.dashPattern.join(' ') : undefined,
      'clip-path': id ? `url(#${id})` : undefined
    })
    if (!id) return [path]
    const reach = stroke.weight * 4
    const around = `M${num(-reach)} ${num(-reach)}h${num(node.width + reach * 2)}v${num(node.height + reach * 2)}h${num(-node.width - reach * 2)}Z`
    const clip = svg('path', {
      d: stroke.align === 'INSIDE' ? d : `${around}${d}`,
      'clip-rule': 'evenodd'
    })
    return [svg('g', {}, svg('clipPath', { id }, clip), path)]
  })
}
