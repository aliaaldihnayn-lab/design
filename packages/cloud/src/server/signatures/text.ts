import {
  beginText,
  endText,
  PDFHexString,
  PDFName,
  setFillingColor,
  setFontAndSize,
  setTextMatrix,
  showText,
  type Color,
  type PDFDocument,
  type PDFFont,
  type PDFPage
} from '@cantoo/pdf-lib'
import * as fontkit from 'fontkit'

/**
 * Text on the audit page in any script: Latin in the standard font, Arabic and other
 * right-to-left text shaped by fontkit in an embedded Arabic font and drawn glyph by glyph at
 * the positions fontkit gives, mark offsets included (pdf-lib's own drawText drops them, which
 * puts the dots of Arabic letters in the wrong place). Runs are ordered right to left when the
 * line starts with right-to-left text.
 */

const RTL = /[֐-ࣿיִ-﷿ﹰ-﻿]/u

export interface ScriptFonts {
  latin: PDFFont
  arabic: { font: PDFFont; shaper: fontkit.Font; name: PDFName } | null
}

export async function embedArabicFont(
  pdf: PDFDocument,
  bytes: Uint8Array | null | undefined
): Promise<ScriptFonts['arabic']> {
  if (!bytes) return null
  pdf.registerFontkit(fontkit)
  const font = await pdf.embedFont(bytes, { subset: false })
  return { font, shaper: fontkit.create(bytes), name: PDFName.of('ArabicAudit') }
}

interface Run {
  text: string
  rtl: boolean
}

/** Splits a line into runs of right-to-left and other text; spaces join the run before them. */
export function scriptRuns(text: string): Run[] {
  const runs: Run[] = []
  for (const char of text) {
    const rtl = RTL.test(char)
    const last = runs.at(-1)
    const neutral = /[\s\d.,:\-()]/u.test(char)
    if (last && (last.rtl === rtl || neutral)) last.text += char
    else runs.push({ text: char, rtl })
  }
  return runs
}

function runWidth(run: Run, fonts: ScriptFonts, size: number): number {
  if (run.rtl && fonts.arabic) {
    const shaped = fonts.arabic.shaper.layout(run.text)
    const scale = size / fonts.arabic.shaper.unitsPerEm
    return shaped.positions.reduce((sum, position) => sum + position.xAdvance * scale, 0)
  }
  return fonts.latin.widthOfTextAtSize(printable(run.text, fonts.latin), size)
}

/** The text with what the standard font cannot draw replaced, so a name never fails a page. */
function printable(text: string, font: PDFFont): string {
  return Array.from(text)
    .map((char) => {
      try {
        font.encodeText(char)
        return char
      } catch {
        return '?'
      }
    })
    .join('')
}

/** Draws one line with its left edge at `x` and its baseline at `y`. */
export function drawLine(
  page: PDFPage,
  text: string,
  options: { x: number; y: number; size: number; color: Color; fonts: ScriptFonts }
): void {
  const { fonts, size } = options
  let runs = scriptRuns(text)
  if (runs[0]?.rtl && fonts.arabic) runs = runs.reverse()
  let x = options.x
  for (const run of runs) {
    const arabic = fonts.arabic
    if (run.rtl && arabic) {
      const shaped = arabic.shaper.layout(run.text)
      const scale = size / arabic.shaper.unitsPerEm
      // Registers the glyphs for the font's ToUnicode map, so the name copies as text.
      arabic.font.encodeText(run.text)
      const key = page.node.newFontDictionary(arabic.name.asString().slice(1), arabic.font.ref)
      page.pushOperators(beginText(), setFontAndSize(key, size), setFillingColor(options.color))
      let cursor = x
      shaped.glyphs.forEach((glyph, index) => {
        const position = shaped.positions[index]
        if (!position) return
        page.pushOperators(
          setTextMatrix(
            1,
            0,
            0,
            1,
            cursor + position.xOffset * scale,
            options.y + position.yOffset * scale
          ),
          showText(PDFHexString.of(glyph.id.toString(16).padStart(4, '0')))
        )
        cursor += position.xAdvance * scale
      })
      page.pushOperators(endText())
    } else {
      page.drawText(printable(run.text, fonts.latin), {
        x,
        y: options.y,
        size,
        font: fonts.latin,
        color: options.color
      })
    }
    x += runWidth(run, fonts, size)
  }
}
