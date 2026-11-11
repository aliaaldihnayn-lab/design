import { describe, expect, setDefaultTimeout, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { corePackagePath, FIXTURES } from '#core-tests/helpers/paths'
import {
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  type PDFObject,
  PDFRawStream
} from '@cantoo/pdf-lib'

import {
  createWriterDocument,
  defaultPageSetup,
  exportWriterPDF,
  readDocx,
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
    const streams: PDFObject[] = contents instanceof PDFArray ? contents.asArray() : []
    if (contents && !(contents instanceof PDFArray)) streams.push(contents)
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

/** Where pdf.js finds each piece of text on the first page, in PDF points. */
async function textPositions(pdf: Uint8Array): Promise<Map<string, { x: number; y: number }>> {
  const worker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs')
  Reflect.set(globalThis, 'pdfjsWorker', worker)
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const doc = await pdfjs.getDocument({ data: pdf.slice(), verbosity: 0, isEvalSupported: false })
    .promise
  const content = await (await doc.getPage(1)).getTextContent()
  const positions = new Map<string, { x: number; y: number }>()
  for (const item of content.items) {
    if ('str' in item && item.str.trim()) {
      positions.set(item.str.trim(), { x: item.transform[4] ?? 0, y: item.transform[5] ?? 0 })
    }
  }
  await doc.destroy()
  return positions
}

const LONG = 'هذا نص عربي طويل يملأ الصفحة ويستمر حتى ينتقل إلى صفحة جديدة. '.repeat(90)

describe('PDF export', () => {
  test('draws a cell merged down two rows beside both, the rows below starting after it', async () => {
    const cellOf = (value: string, attrs: Record<string, unknown> = {}): WriterNode => ({
      type: 'tableCell',
      attrs: { colspan: 1, rowspan: 1, ...attrs },
      content: [paragraph('ltr', text(value))]
    })
    const table: WriterNode = {
      type: 'table',
      content: [
        { type: 'tableRow', content: [cellOf('Merged', { rowspan: 2 }), cellOf('Top')] },
        { type: 'tableRow', content: [cellOf('Second')] },
        { type: 'tableRow', content: [cellOf('Left'), cellOf('Right')] }
      ]
    }
    const pdf = await exportWriterPDF(
      createWriterDocument({ body: { type: 'doc', content: [table] } }),
      { fonts }
    )
    const at = await textPositions(pdf)
    const merged = at.get('Merged')
    const top = at.get('Top')
    const second = at.get('Second')
    const left = at.get('Left')
    if (!merged || !top || !second || !left) throw new Error('text missing')
    // "Second" is in the second column, under "Top", not under "Merged".
    expect(second.x).toBeCloseTo(top.x, 0)
    expect(second.x).toBeGreaterThan(merged.x + 50)
    // The third row starts below both merged rows (pdf.js y grows upwards).
    expect(left.y).toBeLessThan(second.y)
    expect(left.x).toBeCloseTo(merged.x, 0)
  })

  test("draws each section's own page size, header and footer", async () => {
    const sectioned = readDocx(
      new Uint8Array(readFileSync(join(FIXTURES, 'writer/lawha-section-headers.docx')))
    )
    const pdf = await exportWriterPDF(sectioned, { fonts })
    const pages = (await PDFDocument.load(pdf)).getPages()
    expect(pages.map((page) => Math.round(page.getSize().width))).toEqual([612, 792, 792])
    const written = await writtenTexts(pdf)
    expect(written[0]).toContain('عقد إيجار')
    const latin = await pageTexts(pdf)
    expect(latin[1]).toContain('Annex header')
    expect(latin[2]).toContain('Annex header')
    expect(latin[2]).toContain('First footer')
  })

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
