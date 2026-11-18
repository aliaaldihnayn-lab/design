import { describe, expect, test } from 'bun:test'

import * as v from 'valibot'

import {
  createWriterDocument,
  detectDirection,
  documentStatistics,
  mmToTwips,
  PAGE_SIZES,
  pageSizeId,
  twipsToMM,
  writerDocumentSchema
} from '@lawha/core/writer'

describe('writer model', () => {
  test('detects direction from the first strong letter', () => {
    expect(detectDirection('123 مرحبا Hello')).toBe('rtl')
    expect(detectDirection('(Hello) مرحبا')).toBe('ltr')
    expect(detectDirection('123 ...')).toBeNull()
  })

  test('counts words, characters and paragraphs in Arabic and English', () => {
    const stats = documentStatistics({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'عقد عمل' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Two words' }] },
        { type: 'paragraph' }
      ]
    })
    expect(stats).toEqual({ words: 4, characters: 16, charactersNoSpaces: 14, paragraphs: 2 })
  })

  test('names page sizes in either orientation and converts millimetres exactly enough', () => {
    expect(pageSizeId(PAGE_SIZES.a4)).toBe('a4')
    expect(pageSizeId({ width: PAGE_SIZES.letter.height, height: PAGE_SIZES.letter.width })).toBe(
      'letter'
    )
    expect(pageSizeId({ width: 1000, height: 2000 })).toBeNull()
    expect(Math.round(twipsToMM(mmToTwips(25)))).toBe(25)
  })

  test('a new document is a valid A4 document', () => {
    const document = createWriterDocument()
    expect(v.is(writerDocumentSchema, document)).toBe(true)
    expect(pageSizeId(document.page)).toBe('a4')
  })
})
