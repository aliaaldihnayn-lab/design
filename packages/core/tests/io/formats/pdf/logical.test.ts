import { describe, expect, test } from 'bun:test'

import { logicalText, normalizeGlyphText } from '#core/io/formats/pdf/import/logical'

/** Clusters as a PDF draws them, left to right. */
const visual = (...texts: string[]) => texts.map((text) => ({ text }))

describe('text drawn by glyphs, back to the characters it spells', () => {
  test('presentation forms and ligatures are the letters they show; unknown glyphs are dropped', () => {
    expect(normalizeGlyphText('ﻣ')).toBe('م')
    expect(normalizeGlyphText('ﻻ')).toBe('لا')
    expect(normalizeGlyphText('ﬁ')).toBe('fi')
    expect(normalizeGlyphText('\u0000ب�')).toBe('ب')
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
    expect(logicalText(visual('(', 'ب', ')', ' ', 'ا'))).toBe('ا (ب)')
  })
})
