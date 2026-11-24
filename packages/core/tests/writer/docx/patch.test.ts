import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { FIXTURES } from '#core-tests/helpers/paths'
import { strFromU8, unzipSync } from 'fflate'

import {
  createWriterDocument,
  nodeText,
  readDocx,
  writeDocx,
  writerSections,
  type WriterDocument,
  type WriterNode
} from '@lawha/core/writer'

/**
 * Real files from the producers people open: Word 2011 for Mac and Word 2016 (python-docx's
 * test files), and LibreOffice 7 converting `libreoffice-sections.fodt`.
 */
const fixture = (name: string) => new Uint8Array(readFileSync(join(FIXTURES, `writer/${name}`)))

const WORD = ['word-custom-xml.docx', 'word-header-footer.docx', 'word-sections.docx']
const ALL = [
  ...WORD,
  'libreoffice-sections.docx',
  'libreoffice-arabic.docx',
  'lawha-section-headers.docx'
]

function parts(bytes: Uint8Array): Record<string, string> {
  return Object.fromEntries(
    Object.entries(unzipSync(bytes)).map(([path, data]) => [path, strFromU8(data)])
  )
}

function editFirstParagraph(document: WriterDocument, text: string): WriterDocument {
  const content = [...(document.body.content ?? [])]
  const index = content.findIndex((node) => node.type === 'paragraph' && nodeText(node).trim())
  const paragraph = content.at(index)
  if (index === -1 || !paragraph) throw new Error('no paragraph')
  content[index] = { ...paragraph, content: [{ type: 'text', text }] }
  return { ...document, body: { ...document.body, content } }
}

describe('saving a Word file back', () => {
  test.each(ALL)('%s unchanged keeps every part as it was', (name) => {
    const source = fixture(name)
    const before = parts(source)
    const after = parts(writeDocx(readDocx(source), { source }))
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort())
    for (const path of Object.keys(before)) {
      // The main part is written out again from its parsed tree; its markup must not change.
      if (path.endsWith('document.xml')) {
        expect(readDocx(writeDocx(readDocx(source), { source })).body).toEqual(
          readDocx(source).body
        )
      } else expect(after[path]).toBe(before[path])
    }
  })

  test.each(ALL)('%s edited keeps the parts and blocks the edit did not touch', (name) => {
    const source = fixture(name)
    const before = parts(source)
    const read = readDocx(source)
    const saved = writeDocx(editFirstParagraph(read, 'Edited by Lawha'), { source })
    const after = parts(saved)
    for (const path of Object.keys(before)) {
      if (!/document\.xml$|\.rels$|\[Content_Types\]/.test(path)) {
        expect(after[path]).toBe(before[path])
      }
    }
    const reread = readDocx(saved)
    const blocks = (document: WriterDocument) => (document.body.content ?? []).map(nodeText)
    expect(blocks(reread).filter((text) => text === 'Edited by Lawha')).toHaveLength(1)
    // Every other block reads back as it was.
    const untouched = blocks(read).filter((_, index) => blocks(reread)[index] !== 'Edited by Lawha')
    expect(blocks(reread).filter((text) => text !== 'Edited by Lawha')).toEqual(untouched)
    expect(reread.page).toEqual(read.page)
  })

  test('keeps a text box, theme and section setup that the model does not edit', () => {
    const source = fixture('libreoffice-sections.docx')
    const saved = parts(writeDocx(editFirstParagraph(readDocx(source), 'تعديل'), { source }))
    const document = saved['word/document.xml'] ?? ''
    expect(document).toContain('<w:txbxContent>')
    expect(document).toContain('نص داخل مربع نص')
    expect(document).toContain('w:orient="landscape"')
    expect(document).toContain('تعديل')
    expect(saved['word/theme/theme1.xml']).toBe(parts(source)['word/theme/theme1.xml'])
  })

  test('editing the paragraph a text box anchors to keeps the text box', () => {
    const source = fixture('libreoffice-sections.docx')
    const read = readDocx(source)
    const content = [...(read.body.content ?? [])]
    const index = content.findIndex((node) => nodeText(node).includes('مربع نص'))
    const anchor = content.at(index)
    if (index === -1 || !anchor) throw new Error('no anchor paragraph')
    content[index] = { ...anchor, content: [{ type: 'text', text: 'فقرة معدّلة' }] }
    const saved = writeDocx({ ...read, body: { ...read.body, content } }, { source })
    const xml = parts(saved)['word/document.xml'] ?? ''
    expect(xml).toContain('فقرة معدّلة')
    expect(xml).toContain('نص داخل مربع نص')
    // The paragraph also ends the first section, which keeps its own setup.
    expect(readDocx(saved).body.content?.map((node) => node.type)).toEqual(
      read.body.content?.map((node) => node.type)
    )
    expect(xml).toContain('<w:pgNumType w:fmt="decimal"/>')
  })

  test('changing a section page keeps its type, columns and headers without new parts', () => {
    const source = fixture('libreoffice-sections.docx')
    const read = readDocx(source)
    const content = (read.body.content ?? []).map((node) =>
      node.type === 'sectionBreak'
        ? { ...node, attrs: { ...node.attrs, page: { ...read.page, width: 12240, height: 15840 } } }
        : node
    )
    const saved = writeDocx({ ...read, body: { ...read.body, content } }, { source })
    const before = parts(source)
    const after = parts(saved)
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort())
    const first = (after['word/document.xml'] ?? '').match(/<w:sectPr>.*?<\/w:sectPr>/)?.[0] ?? ''
    expect(first).toContain('<w:pgSz w:w="12240" w:h="15840"')
    expect(first).toContain('<w:type w:val="nextPage"/>')
    expect(first).toContain('<w:docGrid')
    expect(first).toContain('<w:headerReference')
    const sections = (document: WriterDocument) =>
      writerSections(document).map((section) => section.header && nodeText(section.header))
    expect(sections(readDocx(saved))).toEqual(sections(read))
  })

  test('numbers new tracked changes after the ones the file keeps', () => {
    const change = (text: string): WriterNode => ({
      type: 'paragraph',
      attrs: { dir: 'rtl' },
      content: [
        {
          type: 'text',
          text,
          marks: [{ type: 'insertion', attrs: { author: 'سارة', date: '2026-01-02T00:00:00Z' } }]
        }
      ]
    })
    const source = writeDocx(
      createWriterDocument({ body: { type: 'doc', content: [change('أول'), change('ثان')] } })
    )
    const read = readDocx(source)
    const content = [...(read.body.content ?? []), change('ثالث')]
    const saved = writeDocx({ ...read, body: { ...read.body, content } }, { source })
    const xml = parts(saved)['word/document.xml'] ?? ''
    const ids = [...xml.matchAll(/<w:(?:ins|del) w:id="(\d+)"/g)].map(([, id]) => id)
    expect(ids).toHaveLength(3)
    expect(new Set(ids).size).toBe(3)
  })

  test('keeps custom XML parts, numbering and styles of a Word file', () => {
    const source = fixture('word-custom-xml.docx')
    const before = parts(source)
    const after = parts(writeDocx(editFirstParagraph(readDocx(source), 'Changed'), { source }))
    for (const path of ['customXml/item1.xml', 'word/numbering.xml', 'word/styles.xml']) {
      expect(after[path]).toBe(before[path])
    }
  })

  test('an edited paragraph keeps the properties of the paragraph it replaced', () => {
    const source = fixture('libreoffice-sections.docx')
    const read = readDocx(source)
    const index = (read.body.content ?? []).findIndex((node) => nodeText(node).startsWith('اقتباس'))
    const content = [...(read.body.content ?? [])]
    const quote = content.at(index)
    if (index === -1 || !quote) throw new Error('no quote')
    content[index] = { ...quote, content: [{ type: 'text', text: 'اقتباس معدّل' }] }
    const saved = writeDocx({ ...read, body: { ...read.body, content } }, { source })
    const xml = parts(saved)['word/document.xml'] ?? ''
    const paragraph = xml.slice(xml.lastIndexOf('<w:p>', xml.indexOf('اقتباس معدّل')))
    expect(paragraph.slice(0, paragraph.indexOf('</w:pPr>'))).toContain('w:val="Quote"')
  })

  test('adding blocks numbers new lists after the file’s own and adds missing styles', () => {
    const source = fixture('word-custom-xml.docx')
    const read = readDocx(source)
    const added: WriterNode[] = [
      {
        type: 'heading',
        attrs: { level: 2, dir: 'ltr' },
        content: [{ type: 'text', text: 'New' }]
      },
      {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'item' }] }]
          }
        ]
      }
    ]
    const document = {
      ...read,
      body: { ...read.body, content: [...(read.body.content ?? []), ...added] }
    }
    const before = parts(source)
    const saved = writeDocx(document, { source })
    const after = parts(saved)
    const numIds = (xml: string) => [...xml.matchAll(/<w:num w:numId="(\d+)"/g)].map((m) => m[1])
    const added_ = numIds(after['word/numbering.xml'] ?? '').filter(
      (id) => !numIds(before['word/numbering.xml'] ?? '').includes(id)
    )
    expect(added_).toHaveLength(1)
    expect(numIds(before['word/numbering.xml'] ?? '')).not.toContain(added_[0])
    const reread = readDocx(saved)
    expect(reread.body.content?.at(-1)?.type).toBe('bulletList')
    expect(nodeText(reread.body.content?.at(-2) ?? { type: 'doc' })).toBe('New')
  })

  test('a header added to the last section gets a part of its own; other sections keep theirs', () => {
    const source = fixture('word-header-footer.docx')
    const read = readDocx(source)
    const header: WriterNode = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'New header' }] }]
    }
    const saved = writeDocx({ ...read, header }, { source })
    expect(nodeText(readDocx(saved).header ?? { type: 'doc' })).toBe('New header')
    const before = parts(source)
    const after = parts(saved)
    const headers = (files: Record<string, string>) =>
      Object.keys(files).filter((path) => /header\d*\.xml$/.test(path))
    for (const path of headers(before)) expect(after[path]).toBe(before[path])
    expect(headers(after)).toHaveLength(headers(before).length + 1)
  })

  test('a changed page setup patches the last section only', () => {
    const source = fixture('libreoffice-sections.docx')
    const read = readDocx(source)
    const page = { ...read.page, margins: { ...read.page.margins, left: 2000 } }
    const saved = writeDocx({ ...read, page }, { source })
    expect(readDocx(saved).page).toEqual(page)
    const xml = parts(saved)['word/document.xml'] ?? ''
    expect(xml.match(/<w:sectPr/g)).toHaveLength(2)
  })
})

describe('reading Word styles', () => {
  test('resolves document defaults, paragraph styles and based-on chains', () => {
    const read = readDocx(fixture('libreoffice-sections.docx'))
    expect(read.defaults).toMatchObject({
      fontFamily: 'Liberation Serif',
      fontFamilyComplex: 'Amiri',
      fontSize: 12,
      fontSizeComplex: 14
    })
    const blocks = read.body.content ?? []
    // Right to left from the Normal style, which LibreOffice writes `w:bidi` on.
    expect(blocks[0]?.attrs?.dir).toBe('rtl')
    expect(blocks[0]?.content?.[0]?.marks ?? []).toEqual([])
    // The Quote style is italic and blue, based on Normal.
    const quote = blocks.find((node) => nodeText(node).startsWith('اقتباس'))
    const marks = quote?.content?.[0]?.marks ?? []
    expect(marks.map((mark) => mark.type)).toContain('italic')
    expect(marks.find((mark) => mark.type === 'textStyle')?.attrs).toMatchObject({
      color: '#1f497d'
    })
  })

  test('reads every section with its own page setup', () => {
    const read = readDocx(fixture('libreoffice-sections.docx'))
    const breaks = (read.body.content ?? []).filter((node) => node.type === 'sectionBreak')
    expect(breaks).toHaveLength(1)
    expect(breaks[0]?.attrs?.page).toMatchObject({ width: 11906, height: 16838 })
    expect(read.page).toMatchObject({ width: 16838, height: 11906 })
    const word = readDocx(fixture('word-sections.docx'))
    expect((word.body.content ?? []).filter((node) => node.type === 'sectionBreak')).toHaveLength(2)
  })

  test('a document without its source package writes section breaks Word reads back', () => {
    const read = readDocx(fixture('libreoffice-sections.docx'))
    const reread = readDocx(writeDocx(read))
    const pages = (document: WriterDocument) =>
      (document.body.content ?? [])
        .filter((node) => node.type === 'sectionBreak')
        .map((node) => node.attrs?.page)
    expect(pages(reread)).toEqual(pages(read))
    expect(reread.page).toEqual(read.page)
  })
})
