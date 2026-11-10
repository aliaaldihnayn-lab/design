import { describe, expect, test } from 'bun:test'

import { strFromU8, unzipSync } from 'fflate'

import { createWriterDocument, readDocx, writeDocx, type WriterNode } from '@lawha/core/writer'

/** A 1×1 red PNG. */
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='

const text = (value: string, marks?: WriterNode['marks']): WriterNode =>
  marks ? { type: 'text', text: value, marks } : { type: 'text', text: value }

const paragraph = (attrs: Record<string, unknown>, ...content: WriterNode[]): WriterNode => ({
  type: 'paragraph',
  attrs,
  content
})

function roundTrip(body: WriterNode[], extra: Parameters<typeof createWriterDocument>[0] = {}) {
  const bytes = writeDocx(createWriterDocument({ body: { type: 'doc', content: body }, ...extra }))
  return { document: readDocx(bytes), files: unzipSync(bytes) }
}

describe('docx round trip', () => {
  test('keeps headings, direction, alignment and run formatting', () => {
    const body: WriterNode[] = [
      {
        type: 'heading',
        attrs: { level: 1, dir: 'rtl', textAlign: 'center' },
        content: [text('عقد')]
      },
      { type: 'heading', attrs: { level: 3, dir: 'ltr' }, content: [text('Terms')] },
      paragraph(
        { dir: 'rtl', textAlign: 'right' },
        text('غامق', [{ type: 'bold' }]),
        text(' مائل', [{ type: 'italic' }]),
        text(' تحته خط', [{ type: 'underline' }]),
        text(' ملوّن', [
          { type: 'textStyle', attrs: { color: '#c00000', fontFamily: 'Amiri', fontSize: '16pt' } }
        ])
      ),
      paragraph({ dir: 'rtl', textAlign: 'left' }, text('يسار')),
      paragraph({ dir: 'ltr', textAlign: 'justify' }, text('Justified', [{ type: 'strike' }]))
    ]
    const { document, files } = roundTrip(body)
    expect(document.body.content).toEqual(body)
    const xml = strFromU8(files['word/document.xml'])
    // Word swaps left and right in RTL paragraphs: right-aligned Arabic is written as `left`.
    expect(xml).toContain('<w:bidi/><w:jc w:val="left"/>')
    expect(xml).toContain('<w:szCs w:val="32"/>')
  })

  test('keeps nested bulleted and numbered lists', () => {
    const item = (label: string, ...nested: WriterNode[]): WriterNode => ({
      type: 'listItem',
      content: [paragraph({ dir: 'ltr' }, text(label)), ...nested]
    })
    const body: WriterNode[] = [
      {
        type: 'orderedList',
        attrs: { start: 3 },
        content: [
          item('three', { type: 'bulletList', content: [item('a'), item('b')] }),
          item('four')
        ]
      },
      paragraph({ dir: 'ltr' }, text('between')),
      { type: 'bulletList', content: [item('dot')] }
    ]
    expect(roundTrip(body).document.body.content).toEqual(body)
  })

  test('keeps tables with merged cells, links, images and page breaks', () => {
    const cell = (label: string, attrs: Record<string, unknown> = {}): WriterNode => ({
      type: 'tableCell',
      attrs: { colspan: 1, rowspan: 1, colwidth: [120], ...attrs },
      content: [paragraph({ dir: 'ltr' }, text(label))]
    })
    const table: WriterNode = {
      type: 'table',
      attrs: { dir: 'rtl' },
      content: [
        {
          type: 'tableRow',
          content: [
            cell('wide', { colspan: 2, colwidth: [120, 120] }),
            cell('tall', { rowspan: 2 })
          ]
        },
        { type: 'tableRow', content: [cell('a'), cell('b')] },
        { type: 'tableRow', content: [cell('c'), cell('d'), cell('e')] }
      ]
    }
    const body: WriterNode[] = [
      table,
      paragraph(
        { dir: 'ltr' },
        text('Lawha', [{ type: 'link', attrs: { href: 'https://example.com/' } }]),
        { type: 'image', attrs: { src: PNG, width: 40, height: 40 } }
      ),
      { type: 'pageBreak' },
      paragraph({ dir: 'rtl' }, text('الصفحة الثانية'))
    ]
    const { document, files } = roundTrip(body)
    expect(document.body.content).toEqual(body)
    expect(Object.keys(files).some((path) => path.startsWith('word/media/'))).toBe(true)
    const xml = strFromU8(files['word/document.xml'])
    expect(xml).toContain('<w:vMerge w:val="restart"/>')
    expect(xml).toContain('<w:bidiVisual/>')
  })

  test('keeps page setup, header and footer with page numbers', () => {
    const header: WriterNode = { type: 'doc', content: [paragraph({ dir: 'rtl' }, text('ترويسة'))] }
    const footer: WriterNode = {
      type: 'doc',
      content: [
        paragraph(
          { dir: 'ltr', textAlign: 'center' },
          text('Page '),
          { type: 'pageNumber' },
          text(' of '),
          { type: 'pageCount' }
        )
      ]
    }
    const page = {
      width: 16838,
      height: 11906,
      margins: { top: 1000, right: 1100, bottom: 1200, left: 1300, header: 500, footer: 600 }
    }
    const { document } = roundTrip([paragraph({ dir: 'ltr' }, text('x'))], {
      page,
      header,
      footer,
      title: 'Report'
    })
    expect(document.page).toEqual(page)
    expect(document.header).toEqual(header)
    expect(document.footer).toEqual(footer)
    expect(document.title).toBe('Report')
  })

  test('keeps comments, their resolved state, and tracked changes as Word records them', () => {
    const change = { author: 'Ali', date: '2026-11-10T10:00:00Z' }
    const body: WriterNode[] = [
      paragraph(
        { dir: 'rtl' },
        text('بند ', [{ type: 'comment', attrs: { commentId: 'c0' } }]),
        text('أول', [{ type: 'bold' }, { type: 'comment', attrs: { commentId: 'c0' } }]),
        text(' محذوف', [{ type: 'deletion', attrs: change }]),
        text(' مضاف', [{ type: 'insertion', attrs: change }])
      ),
      paragraph({ dir: 'ltr' }, text('Second', [{ type: 'comment', attrs: { commentId: 'c1' } }]))
    ]
    const comments = [
      {
        id: 'c0',
        author: 'Ali',
        initials: 'A',
        date: '2026-11-10T10:00:00Z',
        text: 'راجع هذا البند\nسطر ثانٍ'
      },
      { id: 'c1', author: 'Sara', date: '2026-11-10T11:00:00Z', text: 'Done', resolved: true }
    ]
    const { document, files } = roundTrip(body, { comments, trackChanges: true })
    expect(document.body.content).toEqual(body)
    expect(document.comments).toEqual(comments)
    expect(document.trackChanges).toBe(true)
    const xml = strFromU8(files['word/document.xml'])
    expect(xml).toContain('<w:del w:id=')
    expect(xml).toContain('<w:delText xml:space="preserve"> محذوف</w:delText>')
    expect(xml).toContain('<w:commentRangeStart w:id="0"/>')
    expect(strFromU8(files['word/commentsExtended.xml'])).toContain('w15:done="1"')
  })
})
