import { describe, expect, test } from 'bun:test'

import { parsePDFFontName } from '#core/io/formats/pdf/import/font-name'

describe('PDF font names', () => {
  test('read the family, weight and slant a PostScript name gives', () => {
    expect(parsePDFFontName('ABCDEF+Inter-SemiBoldItalic')).toEqual({
      family: 'Inter',
      weight: 600,
      italic: true
    })
    expect(parsePDFFontName('NotoSansArabic-ExtraBold')).toEqual({
      family: 'Noto Sans Arabic',
      weight: 800,
      italic: false
    })
    expect(parsePDFFontName('Helvetica-Oblique')).toEqual({
      family: 'Helvetica',
      weight: 400,
      italic: true
    })
    expect(parsePDFFontName('Arial-BoldMT').family).toBe('Arial')
    expect(parsePDFFontName('ArialMT')).toEqual({ family: 'Arial', weight: 400, italic: false })
    expect(parsePDFFontName('TimesNewRomanPS-BoldItalicMT')).toEqual({
      family: 'Times New Roman',
      weight: 700,
      italic: true
    })
    expect(parsePDFFontName('Cairo-Light').weight).toBe(300)
    expect(parsePDFFontName('Montserrat-Black').weight).toBe(900)
  })

  test('take bold and italic from the font flags when the name has no style', () => {
    expect(parsePDFFontName('Tajawal', { bold: true })).toEqual({
      family: 'Tajawal',
      weight: 700,
      italic: false
    })
  })

  test('read a style written onto the family name', () => {
    expect(parsePDFFontName('CAAAAA+FreeSerifBold')).toEqual({
      family: 'Free Serif',
      weight: 700,
      italic: false
    })
    expect(parsePDFFontName('ArialBoldItalic')).toEqual({
      family: 'Arial',
      weight: 700,
      italic: true
    })
    expect(parsePDFFontName('FreeSans').family).toBe('Free Sans')
  })

  test('name a variable font by its family', () => {
    expect(parsePDFFontName('AAAAAA+InterVariable').family).toBe('Inter')
    expect(parsePDFFontName('NotoKufiArabicVF-Bold')).toEqual({
      family: 'Noto Kufi Arabic',
      weight: 700,
      italic: false
    })
  })
})
