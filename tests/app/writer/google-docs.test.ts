import { describe, expect, test } from 'bun:test'

import type { GoogleDocument } from '@lawha/core/writer'

import {
  createGoogleDocsClient,
  parseGoogleDocId
} from '@/app/integrations/storage/google-drive/docs'
import { openGoogleDocument, saveWriterDocument } from '@/app/writer/document'
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
    expect(await saveWriterDocument(client)).toEqual({ status: 'done' })
    const update = calls.find((call) => call.url.endsWith(`${ID}:batchUpdate`))
    expect(update?.body).toMatchObject({ writeControl: { requiredRevisionId: 'rev-1' } })
    expect(JSON.stringify(update?.body)).toContain('مرحبا')
    expect(writerSource.value).toEqual({ kind: 'google', documentId: ID, revisionId: 'rev-2' })
    expect(writerDirty.value).toBe(false)
  })
})
