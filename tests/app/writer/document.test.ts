import { describe, expect, test } from 'bun:test'

import { createWriterDocument, writeDocx } from '@lawha/core/writer'

import { openWordBytes } from '@/app/writer/document'
import { writerDirty, writerDocument, writerName, writerSource } from '@/app/writer/session'

const target = { handle: null, path: '/tmp/contract.docx' }

describe('opening Word documents in the document editor', () => {
  test('loads the document, its name, and where Save writes it', () => {
    const bytes = writeDocx(
      createWriterDocument({
        body: {
          type: 'doc',
          content: [
            { type: 'paragraph', attrs: { dir: 'rtl' }, content: [{ type: 'text', text: 'بند' }] }
          ]
        }
      })
    )
    writerDirty.value = true
    expect(openWordBytes(bytes, 'contract.docx', target)).toEqual({ status: 'done' })
    expect(writerName.value).toBe('contract')
    // Save patches the very package that was opened.
    expect(writerSource.value).toEqual({ kind: 'file', ...target, package: bytes })
    expect(writerDirty.value).toBe(false)
    expect(writerDocument.value.body.content?.[0].content?.[0].text).toBe('بند')
  })

  test('reports a file that is not a Word document without replacing the open one', () => {
    const before = writerDocument.value
    const outcome = openWordBytes(new TextEncoder().encode('plain text'), 'notes.docx', target)
    expect(outcome).toMatchObject({ status: 'failed', reason: 'not-docx' })
    expect(writerDocument.value).toBe(before)
  })
})
