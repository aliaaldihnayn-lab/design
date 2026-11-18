import { describe, expect, test } from 'bun:test'

import * as v from 'valibot'

import {
  createWriterDocument,
  googleDocsRequests,
  googleDocumentSchema,
  nodeText,
  readGoogleDocument,
  type WriterNode
} from '@lawha/core/writer'

const run = (content: string, textStyle: Record<string, unknown> = {}) => ({
  textRun: { content, textStyle }
})

/** A document as `documents.get` returns it, trimmed to what the converter reads. */
const apiDocument = {
  documentId: 'doc-1',
  title: 'عقد',
  revisionId: 'rev-1',
  documentStyle: {
    defaultFooterId: 'f1',
    pageSize: { width: { magnitude: 595.3, unit: 'PT' }, height: { magnitude: 841.9, unit: 'PT' } },
    marginTop: { magnitude: 72, unit: 'PT' }
  },
  footers: {
    f1: {
      content: [
        {
          paragraph: {
            paragraphStyle: { alignment: 'CENTER' },
            elements: [{ autoText: { type: 'PAGE_NUMBER' } }, run('\n')]
          }
        }
      ]
    }
  },
  lists: {
    l1: { listProperties: { nestingLevels: [{ glyphType: 'DECIMAL' }, { glyphSymbol: '●' }] } }
  },
  body: {
    content: [
      { sectionBreak: {}, endIndex: 1 },
      {
        startIndex: 1,
        endIndex: 6,
        paragraph: {
          paragraphStyle: {
            namedStyleType: 'HEADING_1',
            direction: 'RIGHT_TO_LEFT',
            alignment: 'START'
          },
          elements: [run('عقد\n')]
        }
      },
      {
        paragraph: {
          paragraphStyle: {
            namedStyleType: 'NORMAL_TEXT',
            direction: 'RIGHT_TO_LEFT',
            alignment: 'END'
          },
          elements: [
            run('نص ', {}),
            run('عريض', { bold: true, foregroundColor: { color: { rgbColor: { red: 1 } } } }),
            run(' ', {}),
            run('رابط', { link: { url: 'https://example.com' }, underline: true }),
            run('\n')
          ]
        }
      },
      { paragraph: { bullet: { listId: 'l1', nestingLevel: 0 }, elements: [run('first\n')] } },
      { paragraph: { bullet: { listId: 'l1', nestingLevel: 1 }, elements: [run('nested\n')] } },
      {
        table: {
          rows: 2,
          columns: 2,
          tableRows: [
            {
              tableCells: [
                {
                  tableCellStyle: { columnSpan: 2 },
                  content: [{ paragraph: { elements: [run('merged\n')] } }]
                },
                {
                  tableCellStyle: { columnSpan: 0 },
                  content: [{ paragraph: { elements: [run('\n')] } }]
                }
              ]
            },
            {
              tableCells: [
                { content: [{ paragraph: { elements: [run('a\n')] } }] },
                { content: [{ paragraph: { elements: [run('b\n')] } }] }
              ]
            }
          ]
        }
      },
      { endIndex: 60, paragraph: { elements: [{ pageBreak: {} }, run('\n')] } }
    ]
  }
}

describe('Google Docs', () => {
  test('validates and reads headings, direction, alignment, styles, links, lists, tables', () => {
    const parsed = v.parse(googleDocumentSchema, apiDocument)
    const document = readGoogleDocument(parsed)
    const [heading, paragraph, list, table, pageBreak] = document.body.content ?? []
    expect(heading).toEqual({
      type: 'heading',
      attrs: { dir: 'rtl', textAlign: 'right', level: 1 },
      content: [{ type: 'text', text: 'عقد' }]
    })
    expect(paragraph.attrs).toEqual({ dir: 'rtl', textAlign: 'left' })
    expect(paragraph.content?.[1].marks).toEqual([
      { type: 'bold' },
      { type: 'textStyle', attrs: { color: '#ff0000' } }
    ])
    expect(paragraph.content?.[3].marks).toEqual([
      { type: 'link', attrs: { href: 'https://example.com' } }
    ])
    expect(list.type).toBe('orderedList')
    expect(nodeText(list)).toBe('first\nnested')
    expect(list.content?.[0].content?.[1].type).toBe('bulletList')
    expect(table.content?.[0].content).toHaveLength(1)
    expect(table.content?.[0].content?.[0].attrs?.colspan).toBe(2)
    expect(pageBreak.type).toBe('pageBreak')
    expect(document.footer?.content?.[0].content).toEqual([{ type: 'pageNumber' }])
    expect(document.page.width).toBe(11906)
    expect(document.title).toBe('عقد')
  })

  test('writes the body back block by block, so the Doc ends up in document order', () => {
    const body: WriterNode = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2, dir: 'rtl', textAlign: 'center' },
          content: [{ type: 'text', text: 'عنوان' }]
        },
        {
          type: 'paragraph',
          attrs: { dir: 'rtl' },
          content: [{ type: 'text', text: 'غامق', marks: [{ type: 'bold' }] }]
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
    }
    const requests = googleDocsRequests(createWriterDocument({ body }), {
      body: { content: [{ endIndex: 40 }] }
    })
    expect(requests[0]).toEqual({ deleteContentRange: { range: { startIndex: 1, endIndex: 39 } } })
    // Replay the insertions on a plain string: each lands at index 1, before what came later.
    let text = '\n'
    const insertSchema = v.object({
      insertText: v.object({ location: v.object({ index: v.number() }), text: v.string() })
    })
    for (const request of requests) {
      const insert = v.safeParse(insertSchema, request)
      if (!insert.success) continue
      const at = insert.output.insertText.location.index - 1
      text = text.slice(0, at) + insert.output.insertText.text + text.slice(at)
    }
    expect(text).toBe('عنوان\nغامق\nitem\n\n')
    const heading = requests.find((request) => JSON.stringify(request).includes('HEADING_2'))
    expect(heading).toMatchObject({
      updateParagraphStyle: { paragraphStyle: { alignment: 'CENTER', direction: 'RIGHT_TO_LEFT' } }
    })
    expect(requests).toContainEqual({
      updateTextStyle: {
        range: { startIndex: 7, endIndex: 11 },
        textStyle: { bold: true },
        fields: 'bold'
      }
    })
    expect(requests).toContainEqual({
      createParagraphBullets: {
        range: { startIndex: 1, endIndex: 6 },
        bulletPreset: 'BULLET_DISC_CIRCLE_SQUARE'
      }
    })
  })

  test('writes tables cell by cell, last first, then merges', () => {
    const cell = (text: string, attrs: Record<string, unknown> = {}): WriterNode => ({
      type: 'tableCell',
      attrs: { colspan: 1, rowspan: 1, ...attrs },
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }]
    })
    const body: WriterNode = {
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            { type: 'tableRow', content: [cell('wide', { colspan: 2 })] },
            { type: 'tableRow', content: [cell('a'), cell('b')] }
          ]
        }
      ]
    }
    const requests = googleDocsRequests(createWriterDocument({ body }), {})
    const inserts = requests.flatMap((request) =>
      'insertText' in request ? [request.insertText] : []
    )
    expect(requests).toContainEqual({
      insertTable: { rows: 2, columns: 2, location: { index: 1 } }
    })
    expect(inserts).toEqual([
      { location: { index: 12 }, text: 'b' },
      { location: { index: 10 }, text: 'a' },
      { location: { index: 5 }, text: 'wide' }
    ])
    expect(requests.at(-1)).toEqual({
      mergeTableCells: {
        tableRange: {
          tableCellLocation: { tableStartLocation: { index: 2 }, rowIndex: 0, columnIndex: 0 },
          rowSpan: 1,
          columnSpan: 2
        }
      }
    })
  })
})
