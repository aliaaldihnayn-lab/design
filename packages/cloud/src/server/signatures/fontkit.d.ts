/** The part of fontkit's API the audit page shapes Arabic names with. */
declare module 'fontkit' {
  import type { PDFDocument } from '@cantoo/pdf-lib'

  type PDFLibFontkit = Parameters<PDFDocument['registerFontkit']>[0]

  export interface Glyph {
    id: number
    advanceWidth: number
  }
  export interface GlyphPosition {
    xAdvance: number
    yAdvance: number
    xOffset: number
    yOffset: number
  }
  export interface GlyphRun {
    glyphs: Glyph[]
    positions: GlyphPosition[]
  }
  export interface Font {
    unitsPerEm: number
    layout(text: string): GlyphRun
  }
  /** Also what pdf-lib's `registerFontkit` expects of it. */
  export function create(buffer: Uint8Array): Font & ReturnType<PDFLibFontkit['create']>
}
