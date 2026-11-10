import { describe, expect, setDefaultTimeout, test } from 'bun:test'

import { PDFDocument } from '@cantoo/pdf-lib'
import * as v from 'valibot'

import { encryptPDF } from '@lawha/core/pdf-sign'
import {
  createWriterDocument,
  decryptDocx,
  DocxPasswordError,
  DocxReadError,
  encryptDocx,
  nodeText,
  readDocx,
  WRITER_TEMPLATE_IDS,
  writeDocx,
  writerDocumentSchema,
  writerTemplate,
  type WriterNode
} from '@lawha/core/writer'

setDefaultTimeout(60_000)

function fieldCount(node: WriterNode): number {
  return (
    (node.type === 'formField' ? 1 : 0) +
    (node.content ?? []).reduce((sum, child) => sum + fieldCount(child), 0)
  )
}

const paragraph = (...content: WriterNode[]): WriterNode => ({
  type: 'paragraph',
  attrs: { dir: 'rtl' },
  content
})

describe('document extras', () => {
  test('every template is a valid document that survives Word', () => {
    for (const id of WRITER_TEMPLATE_IDS) {
      const template = writerTemplate(id)
      expect(v.is(writerDocumentSchema, template)).toBe(true)
      const back = readDocx(writeDocx(template))
      const outline = (nodes: WriterNode[] | undefined) =>
        (nodes ?? []).map((node) => [node.type, nodeText(node), fieldCount(node)])
      expect(outline(back.body.content)).toEqual(outline(template.body.content))
    }
  })

  test('keeps fillable fields, footnotes, a table of contents and the watermark', () => {
    const body: WriterNode[] = [
      { type: 'tableOfContents' },
      {
        type: 'heading',
        attrs: { level: 1, dir: 'rtl' },
        content: [{ type: 'text', text: 'مقدمة' }]
      },
      paragraph(
        { type: 'text', text: 'الاسم: ' },
        { type: 'formField', attrs: { kind: 'text', name: 'الاسم', value: 'علي', checked: false } },
        { type: 'text', text: ' ' },
        { type: 'formField', attrs: { kind: 'date', name: 'التاريخ', value: '', checked: false } },
        { type: 'formField', attrs: { kind: 'checkbox', name: 'موافق', value: '', checked: true } },
        { type: 'text', text: ' مرجع' },
        { type: 'footnote', attrs: { id: 'fn1' } }
      )
    ]
    const footnotes = [{ id: 'fn1', content: [paragraph({ type: 'text', text: 'نص الحاشية' })] }]
    const document = readDocx(
      writeDocx(
        createWriterDocument({
          body: { type: 'doc', content: body },
          footnotes,
          watermark: { text: 'سري' }
        })
      )
    )
    expect(document.body.content).toEqual(body)
    expect(document.footnotes).toEqual(footnotes)
    expect(document.watermark).toEqual({ text: 'سري' })
  })

  test('encrypts a Word document with a password and opens it again', () => {
    const plain = writeDocx(createWriterDocument())
    const locked = encryptDocx(plain, 'كلمة-سر')
    expect(() => readDocx(locked)).toThrow(DocxReadError)
    expect(() => decryptDocx(locked, 'wrong')).toThrow(DocxPasswordError)
    expect(decryptDocx(locked, 'كلمة-سر')).toEqual(plain)
  })

  test('encrypts a PDF with AES-256', async () => {
    const pdf = await PDFDocument.create()
    pdf.addPage()
    const locked = await encryptPDF(await pdf.save(), 'secret')
    const text = new TextDecoder('latin1').decode(locked)
    expect(text).toContain('/Encrypt')
    expect(text).toMatch(/\/V 5/)
  })
})
