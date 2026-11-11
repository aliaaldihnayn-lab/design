import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

import { getSchema } from '@tiptap/core'

import { createWriterDocument, readDocx, writeDocx, type WriterNode } from '@lawha/core/writer'

import { writerExtensions } from '@/app/writer/editor/extensions'

import { testPath } from '#tests/helpers/paths'

const schema = getSchema(writerExtensions())

const text = (value: string, marks?: WriterNode['marks']): WriterNode =>
  marks ? { type: 'text', text: value, marks } : { type: 'text', text: value }

/** Everything the toolbar can produce, as the editor's own JSON. */
const body: WriterNode = {
  type: 'doc',
  content: [
    {
      type: 'heading',
      attrs: { level: 2, dir: 'rtl', textAlign: 'center' },
      content: [text('عنوان')]
    },
    {
      type: 'paragraph',
      attrs: { dir: 'rtl', textAlign: 'right' },
      content: [
        text('غامق', [{ type: 'bold' }, { type: 'italic' }, { type: 'underline' }]),
        text(' x', [{ type: 'superscript' }]),
        text(' ملوّن', [
          { type: 'textStyle', attrs: { color: '#c00000', fontFamily: 'Amiri', fontSize: '14pt' } }
        ]),
        text(' مظلل', [{ type: 'highlight', attrs: { color: '#ffff00' } }])
      ]
    },
    {
      type: 'bulletList',
      attrs: { dir: 'ltr' },
      content: [
        {
          type: 'listItem',
          attrs: { dir: 'ltr' },
          content: [{ type: 'paragraph', attrs: { dir: 'ltr' }, content: [text('item')] }]
        }
      ]
    }
  ]
}

describe('writer editor schema', () => {
  test('accepts the document model the converters produce', () => {
    const node = schema.nodeFromJSON(body)
    node.check()
    expect(node.toJSON().content[1].attrs.dir).toBe('rtl')
  })

  test('accepts a document read back from Word', () => {
    const roundTripped = readDocx(writeDocx(createWriterDocument({ body }))).body
    const node = schema.nodeFromJSON(roundTripped)
    node.check()
    expect(node.textContent).toContain('عنوان')
  })

  test('keeps the section breaks of Word files with several page setups', () => {
    const source = readFileSync(testPath('fixtures/writer/libreoffice-sections.docx'))
    const read = readDocx(new Uint8Array(source)).body
    const node = schema.nodeFromJSON(read)
    node.check()
    const breaks = (node.toJSON().content as WriterNode[]).filter(
      (child) => child.type === 'sectionBreak'
    )
    expect(breaks.map((child) => child.attrs?.page)).toEqual(
      (read.content ?? [])
        .filter((child) => child.type === 'sectionBreak')
        .map((child) => child.attrs?.page)
    )
    expect(breaks).toHaveLength(1)
  })
})
