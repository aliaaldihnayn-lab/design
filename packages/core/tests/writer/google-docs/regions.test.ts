import { describe, expect, test } from 'bun:test'

import {
  createWriterDocument,
  createdRegionIds,
  googleDocsRequests,
  googleDriveComments,
  googleRegionRequests,
  type GoogleDocument,
  type WriterNode
} from '@lawha/core/writer'

/*
 * Fixtures follow Google's documented shapes; no live API is reached:
 * - documents.get: https://developers.google.com/docs/api/reference/rest/v1/documents
 * - createHeader / createFooter replies: https://developers.google.com/docs/api/reference/rest/v1/documents/response
 * - insertInlineImage: https://developers.google.com/docs/api/reference/rest/v1/documents/request#insertinlineimagerequest
 * - Drive comments.create: https://developers.google.com/drive/api/reference/rest/v3/comments/create
 */

const paragraph = (...content: WriterNode[]): WriterNode => ({ type: 'paragraph', content })
const text = (value: string, marks?: WriterNode['marks']): WriterNode => ({
  type: 'text',
  text: value,
  marks
})
const region = (...content: WriterNode[]): WriterNode => ({ type: 'doc', content })

const emptyDoc: GoogleDocument = {
  documentId: 'doc-1',
  revisionId: 'rev-1',
  body: { content: [{ startIndex: 0, endIndex: 1, sectionBreak: {} }] }
}

describe('Google Docs headers and footers', () => {
  test('creates a header the Doc lacks, then fills it with the reply id', () => {
    const model = { ...createWriterDocument(), header: region(paragraph(text('شركة لوحة'))) }
    const plan = googleRegionRequests(model, emptyDoc)
    expect(plan.create).toEqual([
      { createHeader: { type: 'DEFAULT', sectionBreakLocation: { index: 0 } } }
    ])
    const ids = createdRegionIds(plan.create, [{ createHeader: { headerId: 'kix.h1' } }])
    expect(ids).toEqual({ header: 'kix.h1' })
    const fill = plan.fill(ids)
    expect(fill.at(0)).toEqual({
      insertText: { location: { index: 0, segmentId: 'kix.h1' }, text: 'شركة لوحة' }
    })
    expect(plan.skipped).toEqual([])
  })

  test('replaces an existing footer in its own segment and leaves an unchanged one alone', () => {
    const current: GoogleDocument = {
      ...emptyDoc,
      documentStyle: { defaultFooterId: 'kix.f1', defaultHeaderId: 'kix.h1' },
      headers: {
        'kix.h1': {
          content: [
            {
              startIndex: 0,
              endIndex: 5,
              paragraph: { elements: [{ textRun: { content: 'Same\n' } }] }
            }
          ]
        }
      },
      footers: {
        'kix.f1': {
          content: [
            {
              startIndex: 0,
              endIndex: 4,
              paragraph: { elements: [{ textRun: { content: 'Old\n' } }] }
            }
          ]
        }
      }
    }
    const model = {
      ...createWriterDocument(),
      header: region(paragraph(text('Same'))),
      footer: region(paragraph(text('New')))
    }
    const plan = googleRegionRequests(model, current)
    expect(plan.create).toEqual([])
    const fill = plan.fill({})
    expect(fill.at(0)).toEqual({
      deleteContentRange: { range: { startIndex: 0, endIndex: 3, segmentId: 'kix.f1' } }
    })
    expect(fill.at(1)).toEqual({
      insertText: { location: { index: 0, segmentId: 'kix.f1' }, text: 'New' }
    })
    expect(fill.some((request) => JSON.stringify(request).includes('kix.h1'))).toBe(false)
  })

  test('reports a page number field, which Docs cannot insert', () => {
    const model = {
      ...createWriterDocument(),
      footer: region(paragraph(text('Page '), { type: 'pageNumber' }))
    }
    const plan = googleRegionRequests(model, emptyDoc)
    expect(plan.create).toEqual([])
    expect(plan.skipped).toEqual([{ kind: 'pageField', region: 'footer' }])
  })
})

describe('Google Docs images', () => {
  test('inserts an image the caller gave a URI for, at its offset, in points', () => {
    const model = createWriterDocument()
    model.body = region(
      paragraph(
        text('AB'),
        { type: 'image', attrs: { src: 'data:image/png;base64,AA', width: 96, height: 48 } },
        text('C')
      )
    )
    const requests = googleDocsRequests(model, emptyDoc, {
      imageURI: (src) => (src.startsWith('data:') ? 'https://drive.example/img' : null)
    })
    const image = requests.find((request) => 'insertInlineImage' in request)
    expect(image).toEqual({
      insertInlineImage: {
        location: { index: 3 },
        uri: 'https://drive.example/img',
        objectSize: { width: { magnitude: 72, unit: 'PT' }, height: { magnitude: 36, unit: 'PT' } }
      }
    })
    const inserted = requests.find((request) => 'insertText' in request)
    expect(JSON.stringify(inserted)).toContain('"ABC')
  })

  test('leaves out images without a URI', () => {
    const model = createWriterDocument()
    model.body = region(paragraph({ type: 'image', attrs: { src: 'blob:x' } }, text('A')))
    const requests = googleDocsRequests(model, emptyDoc)
    expect(requests.some((request) => 'insertInlineImage' in request)).toBe(false)
  })
})

describe('Drive comments', () => {
  test('quote the text the comment was made on', () => {
    const model = createWriterDocument()
    model.body = region(
      paragraph(text('البند '), text('الأول', [{ type: 'comment', attrs: { commentId: 'c1' } }]))
    )
    model.comments = [
      { id: 'c1', author: 'Sara', date: '2026-01-01T00:00:00Z', text: 'راجع', resolved: true }
    ]
    expect(googleDriveComments(model)).toEqual([
      {
        id: 'c1',
        content: 'راجع',
        quotedFileContent: { mimeType: 'text/plain', value: 'الأول' },
        resolved: true
      }
    ])
  })
})
