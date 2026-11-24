import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { FIXTURES } from '#core-tests/helpers/paths'
import { strFromU8, unzipSync } from 'fflate'

import {
  createWriterDocument,
  defaultPageSetup,
  nodeText,
  readDocx,
  writeDocx,
  writerSections,
  type WriterDocument,
  type WriterNode
} from '@lawha/core/writer'

/**
 * `lawha-section-headers.docx` (python-docx): section one has its own header and footer,
 * section two a landscape page and its own header with the footer linked to the previous, and
 * section three links both, so Word shows section two's header and section one's footer there.
 */
const fixture = (name: string) => new Uint8Array(readFileSync(join(FIXTURES, `writer/${name}`)))

const summary = (doc: WriterDocument) =>
  writerSections(doc).map((section) => ({
    size: [section.page.width, section.page.height],
    header: section.header ? nodeText(section.header) : null,
    footer: section.footer ? nodeText(section.footer) : null
  }))

const EXPECTED = [
  { size: [12240, 15840], header: 'عقد إيجار', footer: 'First footer' },
  { size: [15840, 12240], header: 'Annex header', footer: 'First footer' },
  { size: [15840, 12240], header: 'Annex header', footer: 'First footer' }
]

describe('Word sections', () => {
  test('read the header and footer of every section, linked ones from the section before', () => {
    expect(summary(readDocx(fixture('lawha-section-headers.docx')))).toEqual(EXPECTED)
  })

  test('a LibreOffice section with an empty header shows none', () => {
    expect(summary(readDocx(fixture('libreoffice-sections.docx'))).map((s) => s.header)).toEqual([
      'ترويسة العقد — صفحة ',
      null
    ])
  })

  test('a new file writes each section its own header and footer parts', () => {
    const written = writeDocx(readDocx(fixture('lawha-section-headers.docx')))
    expect(summary(readDocx(written))).toEqual(EXPECTED)
    const files = unzipSync(written)
    const types = strFromU8(files['[Content_Types].xml'])
    const headers = Object.keys(files).filter((path) => /^word\/header\d+\.xml$/.test(path))
    expect(headers.length).toBeGreaterThanOrEqual(2)
    for (const path of headers) expect(types).toContain(`PartName="/${path}"`)
  })

  test('saving back over the file keeps every section', () => {
    const source = fixture('lawha-section-headers.docx')
    const model = readDocx(source)
    const changed = { ...model, title: 'Changed' }
    expect(summary(readDocx(writeDocx(changed, { source })))).toEqual(EXPECTED)
  })

  const paragraph = (text: string): WriterNode => ({
    type: 'paragraph',
    attrs: { dir: 'ltr' },
    content: [{ type: 'text', text }]
  })
  const region = (text: string): WriterNode => ({ type: 'doc', content: [paragraph(text)] })

  test('a break made in the editor shows the document header in Word in both sections', () => {
    const doc = createWriterDocument({
      header: region('Document header'),
      body: {
        type: 'doc',
        content: [
          paragraph('one'),
          { type: 'sectionBreak', attrs: { page: defaultPageSetup('letter') } },
          paragraph('two')
        ]
      }
    })
    const read = readDocx(writeDocx(doc))
    expect(summary(read).map((section) => section.header)).toEqual([
      'Document header',
      'Document header'
    ])
    // The break ends the paragraph before it, as Word writes it, with no empty one added.
    expect(read.body.content?.map((node) => node.type)).toEqual([
      'paragraph',
      'sectionBreak',
      'paragraph'
    ])
  })

  test('a section without a header after one with a header shows none in Word', () => {
    const doc = createWriterDocument({
      body: {
        type: 'doc',
        content: [
          paragraph('one'),
          {
            type: 'sectionBreak',
            attrs: { page: defaultPageSetup(), header: region('First only'), footer: null }
          },
          paragraph('two')
        ]
      }
    })
    expect(summary(readDocx(writeDocx(doc))).map((section) => section.header)).toEqual([
      'First only',
      null
    ])
  })

  test('removing the last section header over a file does not show the previous one', () => {
    const source = fixture('lawha-section-headers.docx')
    const model = readDocx(source)
    const saved = readDocx(writeDocx({ ...model, header: null }, { source }))
    expect(summary(saved).map((section) => section.header)).toEqual([
      'عقد إيجار',
      'Annex header',
      null
    ])
  })
})
