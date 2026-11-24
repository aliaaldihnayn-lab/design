import { describe, expect, test } from 'bun:test'

import { logicalText, normalizeGlyphText } from '#core/io/formats/pdf/import/logical'

/** Clusters as a PDF draws them, left to right. */
const visual = (...texts: string[]) => texts.map((text) => ({ text }))

describe('text drawn by glyphs, back to the characters it spells', () => {
  test('presentation forms and ligatures are the letters they show; unknown glyphs are dropped', () => {
    expect(normalizeGlyphText('\uFEE3')).toBe('\u0645')
    expect(normalizeGlyphText('\uFEFB')).toBe('\u0644\u0627')
    expect(normalizeGlyphText('\uFB01')).toBe('fi')
    expect(normalizeGlyphText('\uFC60')).toBe('\u064E\u0651')
    expect(normalizeGlyphText('\uF0B7')).toBe('\u2022')
    expect(normalizeGlyphText('\u0000\u0628\uFFFD')).toBe('\u0628')
  })

  test('Latin keeps its order', () => {
    expect(logicalText(visual('A', 'B', ' ', 'C'))).toBe('AB C')
  })

  test('Arabic drawn right to left reads from the right', () => {
    expect(logicalText(visual('ة', 'م', 'ق', 'ل', 'ا'))).toBe('القمة')
  })

  test('words and numbers inside Arabic keep their own order, brackets mirror', () => {
    expect(logicalText(visual('2', '0', '2', '4', ' ', 'ة', 'ك', 'ر', 'ش'))).toBe('شركة 2024')
    expect(logicalText(visual('٢', '٠', '٢', '٤', ' ', 'م', 'ا', 'ع'))).toBe('عام ٢٠٢٤')
    expect(logicalText(visual('.', 'm', 'i', 'x', 'e', 'd', ' ', 'ع', 'م'))).toBe('مع mixed.')
    // Arabic numbers and a Latin word beside them are separate runs, even touching.
    expect(
      logicalText(visual('\u0662', '\u0660', 'A', 'B', '\u0629', '\u0643', '\u0631', '\u0634'))
    ).toBe('\u0634\u0631\u0643\u0629AB\u0662\u0660')
    expect(logicalText(visual('(', 'ب', ')', ' ', 'ا'))).toBe('ا (ب)')
  })

  test('a left-to-right line keeps its order, an Arabic word in it read from its right', () => {
    const line = visual(...'the ', 'ة', 'م', 'ق', 'ل', 'ا', ' ', 'ة', 'ك', 'ر', 'ش', ...' (Al) in')
    expect(logicalText(line)).toBe('the شركة القمة (Al) in')
  })

  test('a bracket between a Latin word and a number in Arabic takes the line’s direction', () => {
    // `شركة 2024 (Riyadh)` drawn right to left: the closing bracket shows first, mirrored.
    const line = visual(...'(Riyadh) 2024 ', 'ة', 'ك', 'ر', 'ش')
    expect(logicalText(line)).toBe('شركة 2024 (Riyadh)')
  })
})
