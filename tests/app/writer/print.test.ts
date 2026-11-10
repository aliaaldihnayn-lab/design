import { describe, expect, test } from 'bun:test'

import { createWriterDocument, defaultPageSetup } from '@lawha/core/writer'

import { marginBoxes, printableHTML } from '@/app/writer/print'

describe('printing documents', () => {
  test('sets the page size and margins in millimetres', () => {
    const page = { ...defaultPageSetup('a4'), width: 16838, height: 11906 }
    const html = printableHTML(createWriterDocument({ page }), { bodyHTML: '<p>x</p>' })
    expect(html).toContain('size: 297mm 210.01mm')
    expect(html).toContain('margin: 25.4mm 25.4mm 25.4mm 25.4mm')
    expect(html).toContain('<p>x</p>')
  })

  test('prints header and footer in margin boxes with live page numbers', () => {
    const footer = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { textAlign: 'center' },
          content: [
            { type: 'text', text: 'صفحة "' },
            { type: 'pageNumber' },
            { type: 'text', text: ' / ' },
            { type: 'pageCount' }
          ]
        }
      ]
    }
    expect(marginBoxes(footer, 'bottom')).toBe(
      '@bottom-center { content: "صفحة \\"" counter(page) " / " counter(pages); white-space: pre; font-size: 9pt; }'
    )
    const header = {
      type: 'doc',
      content: [
        { type: 'paragraph', attrs: { dir: 'rtl' }, content: [{ type: 'text', text: 'شركة لوحة' }] }
      ]
    }
    expect(marginBoxes(header, 'top')).toStartWith('@top-right {')
  })

  test('draws a watermark behind every page', () => {
    const html = printableHTML(createWriterDocument({ watermark: { text: 'سري' } }), {
      bodyHTML: ''
    })
    expect(html).toContain(
      '<div class="writer-watermark" aria-hidden="true"><span>سري</span></div>'
    )
  })
})
