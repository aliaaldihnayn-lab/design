import { describe, expect, test } from 'bun:test'

import type { GoogleDocument } from '@lawha/core/writer'

import {
  createGoogleDocsClient,
  parseGoogleDocId
} from '@/app/integrations/storage/google-drive/docs'
import { pickedDocumentId } from '@/app/integrations/storage/google-drive/picker'
import {
  openGoogleDocument,
  pickAndOpenGoogleDocument,
  saveWriterDocument
} from '@/app/writer/document'
import { writerDirty, writerDocument, writerName, writerSource } from '@/app/writer/session'

const ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789'

const doc: GoogleDocument = {
  documentId: ID,
  title: 'مذكرة',
  revisionId: 'rev-1',
  body: {
    content: [
      { endIndex: 1, sectionBreak: {} },
      {
        startIndex: 1,
        endIndex: 7,
        paragraph: {
          paragraphStyle: { direction: 'RIGHT_TO_LEFT' },
          elements: [{ textRun: { content: 'مرحبا\n' } }]
        }
      }
    ]
  }
}

/** A Docs API stand-in that records the calls made to it. */
function fakeDocs() {
  const calls: Array<{ url: string; body: unknown }> = []
  const fetcher = async (input: string, init?: RequestInit) => {
    const url = input
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : null
    calls.push({ url, body })
    const reply = url.endsWith(':batchUpdate')
      ? { writeControl: { requiredRevisionId: 'rev-2' } }
      : doc
    return new Response(JSON.stringify(reply), { status: 200 })
  }
  const client = createGoogleDocsClient(
    { token: async () => 'token', forget: () => undefined },
    fetcher
  )
  return { client, calls }
}

describe('Google Docs in the document editor', () => {
  test('takes a Doc id from a link or as typed', () => {
    expect(parseGoogleDocId(`https://docs.google.com/document/d/${ID}/edit?tab=t.0`)).toBe(ID)
    expect(parseGoogleDocId(` ${ID} `)).toBe(ID)
    expect(parseGoogleDocId('https://example.com/nothing')).toBeNull()
  })

  test('opens a Doc and saves back to the same Doc at the revision it opened', async () => {
    const { client, calls } = fakeDocs()
    expect(
      await openGoogleDocument(`https://docs.google.com/document/d/${ID}/edit`, client)
    ).toEqual({ status: 'done' })
    expect(writerName.value).toBe('مذكرة')
    expect(writerSource.value).toEqual({ kind: 'google', documentId: ID, revisionId: 'rev-1' })
    expect(writerDocument.value.body.content?.[0].attrs?.dir).toBe('rtl')

    writerDirty.value = true
    expect(await saveWriterDocument(client)).toEqual({ status: 'done', skipped: [] })
    const update = calls.find((call) => call.url.endsWith(`${ID}:batchUpdate`))
    expect(update?.body).toMatchObject({ writeControl: { requiredRevisionId: 'rev-1' } })
    expect(JSON.stringify(update?.body)).toContain('مرحبا')
    expect(writerSource.value).toEqual({ kind: 'google', documentId: ID, revisionId: 'rev-2' })
    expect(writerDirty.value).toBe(false)
  })

  /*
   * Recorded shapes follow Google's documentation; no live API is reached:
   * - batchUpdate replies: https://developers.google.com/docs/api/reference/rest/v1/documents/batchUpdate
   * - createHeader reply: https://developers.google.com/docs/api/reference/rest/v1/documents/response#createheaderresponse
   * - comments.list / create / replies.create: https://developers.google.com/drive/api/reference/rest/v3/comments
   * - Picker ResponseObject: https://developers.google.com/drive/picker/reference/picker.responseobject
   */
  test('creates the header, fills it, and posts new comments through Drive', async () => {
    const calls: Array<{ url: string; method: string; body: unknown }> = []
    let batches = 0
    const fetcher = async (url: string, init?: RequestInit) => {
      const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : null
      calls.push({ url, method: init?.method ?? 'GET', body })
      let reply: unknown = doc
      if (url.endsWith(':batchUpdate')) {
        batches++
        reply =
          batches === 2
            ? {
                replies: [{ createHeader: { headerId: 'kix.hdr1' } }],
                writeControl: { requiredRevisionId: `rev-${batches + 1}` }
              }
            : { replies: [], writeControl: { requiredRevisionId: `rev-${batches + 1}` } }
      } else if (url.includes('/comments?fields=comments')) {
        reply = {
          comments: [{ content: 'قديم', quotedFileContent: { mimeType: 'text/plain', value: 'x' } }]
        }
      } else if (url.includes('/replies')) reply = { id: 'reply-1' }
      else if (url.includes('/comments?fields=id')) reply = { id: 'AAAA' }
      return new Response(JSON.stringify(reply), { status: 200 })
    }
    const client = createGoogleDocsClient(
      { token: async () => 'token', forget: () => undefined },
      fetcher
    )
    const model = {
      ...writerDocument.value,
      header: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'ترويسة' }] }]
      },
      body: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'x',
                marks: [{ type: 'comment', attrs: { commentId: 'old' } }]
              },
              {
                type: 'text',
                text: 'بند',
                marks: [{ type: 'comment', attrs: { commentId: 'c1' } }]
              }
            ]
          }
        ]
      },
      comments: [
        { id: 'old', author: 'A', date: '2026-01-01T00:00:00Z', text: 'قديم' },
        { id: 'c1', author: 'A', date: '2026-01-01T00:00:00Z', text: 'جديد', resolved: true }
      ]
    }
    const result = await client.save(ID, model, 'rev-1', true)
    expect(result).toEqual({ revisionId: 'rev-4', skipped: [], commentsPosted: 1 })

    const updates = calls.filter((call) => call.url.endsWith(':batchUpdate'))
    expect(updates).toHaveLength(3)
    expect(updates[1].body).toMatchObject({
      requests: [{ createHeader: { type: 'DEFAULT' } }],
      writeControl: { requiredRevisionId: 'rev-2' }
    })
    expect(JSON.stringify(updates[2].body)).toContain('"segmentId":"kix.hdr1"')
    expect(JSON.stringify(updates[2].body)).toContain('ترويسة')

    const created = calls.find(
      (call) => call.method === 'POST' && call.url.includes('/comments?fields=id')
    )
    expect(created?.url).toStartWith(`https://www.googleapis.com/drive/v3/files/${ID}/comments`)
    expect(created?.body).toEqual({
      content: 'جديد',
      quotedFileContent: { mimeType: 'text/plain', value: 'بند' }
    })
    const resolved = calls.find((call) => call.url.includes('/comments/AAAA/replies'))
    expect(resolved?.body).toEqual({ action: 'resolve' })
  })

  test('reads the chosen Doc from a Picker response', () => {
    const api = {
      Action: { PICKED: 'picked', CANCEL: 'cancel' }
    } as Parameters<typeof pickedDocumentId>[0]
    expect(
      pickedDocumentId(api, {
        action: 'picked',
        docs: [{ id: ID, mimeType: 'application/vnd.google-apps.document' }]
      })
    ).toBe(ID)
    expect(pickedDocumentId(api, { action: 'cancel' })).toBeNull()
  })

  test('asks for a Picker key before opening the Picker', async () => {
    expect(await pickAndOpenGoogleDocument('ar', async () => ID)).toEqual({
      status: 'failed',
      reason: 'picker-unavailable',
      detail: ''
    })
  })
})
