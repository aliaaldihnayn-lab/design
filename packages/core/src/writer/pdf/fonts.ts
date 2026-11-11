import { harfBuzzFont, loadHarfBuzz, shapeText, type HarfBuzzFont } from '#core/text/font/harfbuzz'
import { staticFontInstance } from '#core/text/font/instance'
import { fontAxes, fontTableView, hasTrueTypeOutlines } from '#core/text/font/variation'

/**
 * The faces a document's PDF draws its text in: each family, weight and slant the text asks
 * for, as a static font file the PDF embeds, read by HarfBuzz to shape the text and to say which
 * characters it has. A character a face lacks falls back to the next face that has it.
 */

/** A face the text asks for; `text` is what it will draw, for providers that cut fonts. */
export interface WriterFontRequest {
  family: string
  bold: boolean
  italic: boolean
  text: string
}

/** Gives the font file (TrueType or OpenType) drawing a face, or null when there is none. */
export type WriterFontResolver = (request: WriterFontRequest) => Promise<ArrayBuffer | null>

export interface Face {
  key: string
  family: string
  bold: boolean
  italic: boolean
  /** The static file embedded; a variable font is cut at the face's weight. */
  bytes: ArrayBuffer
  font: HarfBuzzFont
  upem: number
  ascender: number
  descender: number
  bbox: [number, number, number, number]
  trueType: boolean
  /** Whether the font is not bold or italic itself and the PDF fakes it. */
  syntheticBold: boolean
  syntheticItalic: boolean
}

export interface ShapedGlyph {
  glyph: number
  /** The UTF-16 offset in the shaped text of the character the glyph starts. */
  cluster: number
  advance: number
  offsetX: number
  offsetY: number
}

const faceKey = (family: string, bold: boolean, italic: boolean) =>
  `${family}|${bold ? 'b' : ''}${italic ? 'i' : ''}`

function readInt16(view: DataView | null, offset: number): number {
  return view && view.byteLength >= offset + 2 ? view.getInt16(offset) : 0
}

async function staticFile(bytes: ArrayBuffer, bold: boolean): Promise<ArrayBuffer> {
  const weight = fontAxes(bytes)?.find((axis) => axis.tag === 'wght')
  if (!weight) return bytes
  const value = bold ? Math.min(weight.max, 700) : Math.max(weight.min, Math.min(weight.max, 400))
  return (await staticFontInstance(bytes, [{ axis: 'wght', value }])) ?? bytes
}

/** Whether the file is the weight and slant asked for, from its OS/2 and head tables. */
function fileStyle(bytes: ArrayBuffer): { bold: boolean; italic: boolean } {
  const os2 = fontTableView(bytes, 'OS/2')
  const weight = os2 && os2.byteLength >= 6 ? os2.getUint16(4) : 400
  const selection = os2 && os2.byteLength >= 64 ? os2.getUint16(62) : 0
  return { bold: weight >= 600 || (selection & 0x20) !== 0, italic: (selection & 0x01) !== 0 }
}

export class FontSet {
  private readonly faces = new Map<string, Promise<Face | null>>()
  private readonly ready = new Map<string, Face | null>()

  constructor(
    private readonly resolve: WriterFontResolver,
    /** Families tried, in order, for characters the text's own face lacks. */
    readonly fallbacks: readonly string[]
  ) {}

  /** Loads a face, once; resolves to null when nothing draws it. */
  load(family: string, bold: boolean, italic: boolean, text: string): Promise<Face | null> {
    const key = faceKey(family, bold, italic)
    let pending = this.faces.get(key)
    if (!pending) {
      pending = this.open(family, bold, italic, text).then((face) => {
        this.ready.set(key, face)
        return face
      })
      this.faces.set(key, pending)
    }
    return pending
  }

  private async open(family: string, bold: boolean, italic: boolean, text: string) {
    await loadHarfBuzz()
    let source = await this.resolve({ family, bold, italic, text })
    let asked = { bold, italic }
    if (!source && (bold || italic)) {
      source = await this.resolve({ family, bold: false, italic: false, text })
      asked = { bold: false, italic: false }
    }
    if (!source) return null
    const bytes = await staticFile(source, asked.bold)
    const font = harfBuzzFont(bytes)
    if (!font) return null
    const head = fontTableView(bytes, 'head')
    const hhea = fontTableView(bytes, 'hhea')
    const own = fileStyle(bytes)
    const face: Face = {
      key: faceKey(family, bold, italic),
      family,
      bold,
      italic,
      bytes,
      font,
      upem: font.face.upem,
      ascender: readInt16(hhea, 4) || Math.round(font.face.upem * 0.8),
      descender: readInt16(hhea, 6) || -Math.round(font.face.upem * 0.2),
      bbox: [readInt16(head, 36), readInt16(head, 38), readInt16(head, 40), readInt16(head, 42)],
      trueType: hasTrueTypeOutlines(bytes),
      syntheticBold: bold && !own.bold,
      syntheticItalic: italic && !own.italic
    }
    return face
  }

  /** A face already loaded by `load`. */
  loaded(family: string, bold: boolean, italic: boolean): Face | null {
    return this.ready.get(faceKey(family, bold, italic)) ?? null
  }
}

export function hasGlyph(face: Face, char: string): boolean {
  const code = char.codePointAt(0)
  if (code === undefined) return false
  // Spaces, joiners and marks the font lacks still shape: HarfBuzz gives them zero width.
  if (/[\s\u200B-\u200F\u2028-\u202E\u2060-\u206F]/u.test(char)) return true
  return (face.font.font.glyph(code) ?? 0) !== 0
}

/** `text` shaped in `face` at `size` points, in the order the glyphs show (RTL already reversed). */
export function shape(face: Face, text: string, size: number, rtl: boolean): ShapedGlyph[] {
  const scale = size / face.upem
  return shapeText(face.font, text, { rtl }).map((glyph) => ({
    glyph: glyph.codepoint,
    cluster: glyph.cluster,
    advance: (glyph.xAdvance ?? 0) * scale,
    offsetX: (glyph.xOffset ?? 0) * scale,
    offsetY: (glyph.yOffset ?? 0) * scale
  }))
}
