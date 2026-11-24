import { PDFString, type PDFDocument, type PDFRef } from '@cantoo/pdf-lib'

import { fontTableView, hasTrueTypeOutlines } from '#core/text/font/variation'

import { hex4, utf16Hex } from './numbers'

/**
 * Fonts PDF text is shown in by glyph ID: each face a Type 0 font with Identity-H encoding over
 * its TrueType or CFF file, the widths of the glyphs drawn, and a ToUnicode map so the text copies
 * and searches as written. The document writer and design export share it.
 */

/** A face text is drawn in, with the file the PDF embeds and the metrics it declares. */
export interface PDFGlyphFace {
  /** Tells faces apart: one font is written per key. */
  key: string
  /** The PostScript-style name the PDF calls the font by, such as `Inter-Bold`. */
  name: string
  /** The font file: whole, or cut to the glyphs drawn by {@link PDFGlyphFontsOptions.subset}. */
  bytes: ArrayBuffer
  upem: number
  ascender: number
  descender: number
  bbox: [number, number, number, number]
  trueType: boolean
  bold: boolean
  italic: boolean
  /** Whether the font is not bold or italic itself and the PDF fakes it. */
  syntheticBold: boolean
  syntheticItalic: boolean
  /** A glyph's advance in font units, at the instance the text is drawn at. */
  glyphAdvance(glyph: number): number
}

function readInt16(view: DataView | null, offset: number): number {
  return view && view.byteLength >= offset + 2 ? view.getInt16(offset) : 0
}

/** The metrics a font file declares that a PDF font descriptor repeats, from `hhea` and `head`. */
export function glyphFaceMetrics(
  bytes: ArrayBuffer,
  upem: number
): Pick<PDFGlyphFace, 'ascender' | 'descender' | 'bbox' | 'trueType'> {
  const head = fontTableView(bytes, 'head')
  const hhea = fontTableView(bytes, 'hhea')
  return {
    ascender: readInt16(hhea, 4) || Math.round(upem * 0.8),
    descender: readInt16(hhea, 6) || -Math.round(upem * 0.2),
    bbox: [readInt16(head, 36), readInt16(head, 38), readInt16(head, 40), readInt16(head, 42)],
    trueType: hasTrueTypeOutlines(bytes)
  }
}

/** A font as a page names it, and the glyphs drawn in it with the text each stands for. */
export interface PDFGlyphFont {
  /** The resource name content streams select it by. */
  name: string
  face: PDFGlyphFace
  glyphs: Map<number, { text: string; width: number }>
}

export interface PDFGlyphFontsOptions {
  /** Starts every resource name, so the fonts cannot take names other fonts on a page have. */
  prefix?: string
  /** The file to embed for the glyphs drawn, such as a subset; the face's own when left out. */
  subset?: (face: PDFGlyphFace, glyphs: readonly number[]) => Promise<ArrayBuffer | null>
}

export class PDFGlyphFonts {
  private readonly fonts = new Map<string, PDFGlyphFont>()

  constructor(private readonly options: PDFGlyphFontsOptions = {}) {}

  /** The font drawing `face`, named the first time it is asked for. */
  use(face: PDFGlyphFace): PDFGlyphFont {
    let font = this.fonts.get(face.key)
    if (!font) {
      font = {
        name: `${this.options.prefix ?? 'F'}${this.fonts.size + 1}`,
        face,
        glyphs: new Map()
      }
      this.fonts.set(face.key, font)
    }
    return font
  }

  get size(): number {
    return this.fonts.size
  }

  /** The faces drawn in, in the order they were first used. */
  faces(): PDFGlyphFace[] {
    return [...this.fonts.values()].map((font) => font.face)
  }

  /** Writes every font used into `pdf`, and gives each one's reference by its resource name. */
  async write(pdf: PDFDocument): Promise<Map<string, PDFRef>> {
    const refs = new Map<string, PDFRef>()
    let index = 0
    for (const font of this.fonts.values()) {
      const glyphs = [...font.glyphs.keys()]
      const subset = await this.options.subset?.(font.face, glyphs)
      const tag = subset ? `${subsetTag(index)}+` : ''
      index += 1
      refs.set(font.name, writeFont(pdf, font, subset ?? font.face.bytes, tag))
    }
    return refs
  }
}

/** A six-letter tag from a number, as PDF marks a font file it embeds only part of. */
function subsetTag(index: number): string {
  let tag = ''
  let rest = index
  for (let i = 0; i < 6; i++) {
    tag = String.fromCharCode(65 + (rest % 26)) + tag
    rest = Math.floor(rest / 26)
  }
  return tag
}

function writeFont(pdf: PDFDocument, font: PDFGlyphFont, file: ArrayBuffer, tag: string): PDFRef {
  const { context } = pdf
  const { face } = font
  const baseFont = `${tag}${face.name}`
  const bytes = new Uint8Array(file)
  const scale = 1000 / face.upem
  const fontFile = context.register(
    context.flateStream(bytes, face.trueType ? { Length1: bytes.length } : { Subtype: 'OpenType' })
  )
  const [xMin, yMin, xMax, yMax] = face.bbox
  const descriptor = context.register(
    context.obj({
      Type: 'FontDescriptor',
      FontName: baseFont,
      Flags: 4,
      FontBBox: [xMin * scale, yMin * scale, xMax * scale, yMax * scale].map(Math.round),
      ItalicAngle: face.italic && !face.syntheticItalic ? -12 : 0,
      Ascent: Math.round(face.ascender * scale),
      Descent: Math.round(face.descender * scale),
      CapHeight: Math.round(face.ascender * scale * 0.7),
      StemV: face.bold ? 120 : 80,
      [face.trueType ? 'FontFile2' : 'FontFile3']: fontFile
    })
  )
  const widths: Array<number | number[]> = []
  for (const [glyph, info] of [...font.glyphs].sort(([a], [b]) => a - b)) {
    widths.push(glyph, [Math.round(info.width)])
  }
  const cidFont = context.register(
    context.obj({
      Type: 'Font',
      Subtype: face.trueType ? 'CIDFontType2' : 'CIDFontType0',
      BaseFont: baseFont,
      CIDSystemInfo: {
        Registry: PDFString.of('Adobe'),
        Ordering: PDFString.of('Identity'),
        Supplement: 0
      },
      FontDescriptor: descriptor,
      DW: 1000,
      W: widths,
      ...(face.trueType ? { CIDToGIDMap: 'Identity' } : {})
    })
  )
  const toUnicode = context.register(
    context.flateStream(new TextEncoder().encode(toUnicodeCMap(font.glyphs)))
  )
  return context.register(
    context.obj({
      Type: 'Font',
      Subtype: 'Type0',
      BaseFont: baseFont,
      Encoding: 'Identity-H',
      DescendantFonts: [cidFont],
      ToUnicode: toUnicode
    })
  )
}

function toUnicodeCMap(glyphs: Map<number, { text: string }>): string {
  // A glyph after the first of its cluster (a dot or mark the font draws apart) stands for no
  // text of its own, which an empty destination says, so readers do not invent characters.
  const entries = [...glyphs]
  const blocks: string[] = []
  for (let i = 0; i < entries.length; i += 100) {
    const chunk = entries.slice(i, i + 100)
    blocks.push(
      `${chunk.length} beginbfchar\n${chunk
        .map(([glyph, info]) => `<${hex4(glyph)}> <${utf16Hex(info.text)}>`)
        .join('\n')}\nendbfchar`
    )
  }
  return [
    '/CIDInit /ProcSet findresource begin',
    '12 dict begin',
    'begincmap',
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
    '/CMapName /Adobe-Identity-UCS def',
    '/CMapType 2 def',
    '1 begincodespacerange',
    '<0000> <FFFF>',
    'endcodespacerange',
    ...blocks,
    'endcmap',
    'CMapName currentdict /CMap defineresource pop',
    'end',
    'end'
  ].join('\n')
}
