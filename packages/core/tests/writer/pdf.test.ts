import { describe, expect, setDefaultTimeout, test } from 'bun:test'
import { readFileSync } from 'node:fs'

import { corePackagePath } from '#core-tests/helpers/paths'
import {
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream
} from '@cantoo/pdf-lib'

import {
  createWriterDocument,
  defaultPageSetup,
  exportWriterPDF,
  type WriterFontRequest,
  type WriterNode
} from '@lawha/core/writer'

setDefaultTimeout(120_000)

const file = (name: string) => {
  const bytes = readFileSync(corePackagePath('assets', name))
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}
const NASKH = file('NotoNaskhArabic-Regular.ttf')
const INTER = file('InterVariable.ttf')

const requests: WriterFontRequest[] = []
const fonts = async (request: WriterFontRequest) => {
  requests.push(request)
  if (request.family === 'Noto Naskh Arabic') return NASKH
  if (request.family === 'Inter') return INTER
  return null
}

const text = (value: string, marks?: WriterNode['marks']): WriterNode =>
  marks ? { type: 'text', text: value, marks } : { type: 'text', text: value }
const paragraph = (dir: 'rtl' | 'ltr', ...content: WriterNode[]): WriterNode => ({
  type: 'paragraph',
  attrs: { dir },
  content
})

/** Each page's text as written, from the ActualText of its spans. */
async function writtenTexts(pdf: Uint8Array): Promise<string[]> {
  const loaded = await PDFDocument.load(pdf)
  return loaded.getPages().map((page) => {
    const contents = page.node.Contents()
    let streams = contents ? [contents] : []
    if (contents instanceof PDFArray) streams = contents.asArray()
    return streams
      .map((entry) => loaded.context.lookup(entry))
      .filter((stream): stream is PDFRawStream => stream instanceof PDFRawStream)
      .map((stream) => new TextDecoder().decode(decodePDFRawStream(stream).decode()))
      .flatMap((content) =>
        [...content.matchAll(/\/ActualText <FEFF([0-9A-F]*)>/g)].map(([, hex = '']) =>
          String.fromCharCode(
            ...(hex.match(/.{4}/g) ?? []).map((unit) => Number.parseInt(unit, 16))
          )
        )
      )
      .join(' ')
  })
}

async function pageTexts(pdf: Uint8Array): Promise<string[]> {
  const worker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs')
  Reflect.set(globalThis, 'pdfjsWorker', worker)
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const doc = await pdfjs.getDocument({ data: pdf.slice(), verbosity: 0, isEvalSupported: false })
    .promise
  const texts: string[] = []
  for (let index = 1; index <= doc.numPages; index += 1) {
    const page = await doc.getPage(index)
    const content = await page.getTextContent()
    texts.push(
      content.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
    )
  }
  await doc.destroy()
  return texts
}

const LONG = 'هذا نص عربي طويل يملأ الصفحة ويستمر حتى ينتقل إلى صفحة جديدة. '.repeat(90)

describe('PDF export', () => {
  test('flows text into pages with a header and footer numbered on every page', async () => {
    const body: WriterNode = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1, dir: 'rtl' }, content: [text('عقد خدمات')] },
        paragraph('rtl', text(LONG)),
        paragraph('ltr', text('English after Arabic, with '), text('bold', [{ type: 'bold' }])),
        { type: 'pageBreak' },
        paragraph('rtl', text('الصفحة الأخيرة'))
      ]
    }
    const footer: WriterNode = {
      type: 'doc',
      content: [
        paragraph('ltr', text('Page '), { type: 'pageNumber' }, text(' of '), { type: 'pageCount' })
      ]
    }
    const header: WriterNode = { type: 'doc', content: [paragraph('rtl', text('ترويسة'))] }
    const document = createWriterDocument({ body, header, footer, title: 'عقد' })
    const pdf = await exportWriterPDF(document, { fonts })

    const loaded = await PDFDocument.load(pdf)
    const pages = loaded.getPages()
    expect(pages.length).toBeGreaterThanOrEqual(3)
    const size = defaultPageSetup('a4')
    expect(pages[0]?.getSize().width).toBeCloseTo(size.width / 20, 1)
    expect(pages[0]?.getSize().height).toBeCloseTo(size.height / 20, 1)
    expect(loaded.getTitle()).toBe('عقد')

    // pdf.js reads the Latin text glyph by glyph through the fonts' ToUnicode maps.
    const texts = await pageTexts(pdf)
    const count = texts.length
    texts.forEach((page, index) => expect(page).toContain(`Page ${index + 1} of ${count}`))
    expect(texts.join(' ')).toContain('bold')
    // Arabic is written in logical order as each span's ActualText, which copies it as written
    // even where the font draws dots and marks as glyphs of their own.
    const written = await writtenTexts(pdf)
    written.forEach((page) => expect(page).toContain('ترويسة'))
    expect(written[0]).toContain('عقد خدمات')
    expect(written.at(-1)).toContain('الصفحة الأخيرة')
  })

  test('embeds the fonts it draws in, falling back for characters a face lacks', async () => {
    requests.length = 0
    const body: WriterNode = {
      type: 'doc',
      content: [paragraph('ltr', text('Mixed النص here', [{ type: 'bold' }]))]
    }
    const pdf = await exportWriterPDF(createWriterDocument({ body }), { fonts })
    // Calibri is asked for first; none was given, so the fallbacks draw the text.
    expect(requests.some((request) => request.family === 'Calibri' && request.bold)).toBe(true)
    const loaded = await PDFDocument.load(pdf)
    const fontDict = loaded.getPages()[0]?.node.Resources()?.lookup(PDFName.of('Font'), PDFDict)
    const faces = (fontDict?.keys() ?? []).map((key) => fontDict?.lookup(key, PDFDict))
    expect(faces).toHaveLength(2)
    for (const face of faces) {
      expect(face?.get(PDFName.of('Encoding'))?.toString()).toBe('/Identity-H')
      const descendant = face?.lookup(PDFName.of('DescendantFonts'), PDFArray).lookup(0, PDFDict)
      const descriptor = descendant?.lookup(PDFName.of('FontDescriptor'), PDFDict)
      expect(descriptor?.has(PDFName.of('FontFile2'))).toBe(true)
      expect(face?.has(PDFName.of('ToUnicode'))).toBe(true)
    }
    expect((await pageTexts(pdf))[0]).toContain('Mixed')
  })

  test('lays out each section on its own page setup', async () => {
    const landscape = { ...defaultPageSetup('a4'), width: 16838, height: 11906 }
    const body: WriterNode = {
      type: 'doc',
      content: [
        paragraph('ltr', text('portrait')),
        { type: 'sectionBreak', attrs: { page: defaultPageSetup('a4') } },
        paragraph('ltr', text('landscape'))
      ]
    }
    const pdf = await exportWriterPDF(createWriterDocument({ body, page: landscape }), { fonts })
    const pages = (await PDFDocument.load(pdf)).getPages().map((page) => page.getSize())
    expect(pages).toHaveLength(2)
    expect(pages[0]?.width).toBeLessThan(pages[0]?.height ?? 0)
    expect(pages[1]?.width).toBeGreaterThan(pages[1]?.height ?? 0)
  })
})
