import { beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test'

import { expectDefined } from '#core-tests/helpers/assert'
import {
  decodePDFRawStream,
  PDFArray,
  PDFDocument,
  type PDFObject,
  PDFRawStream
} from '@cantoo/pdf-lib'

import { BUILTIN_IO_FORMATS, IORegistry } from '@lawha/core/io'
import { SceneGraph, type Fill, type SceneNode } from '@lawha/scene-graph'
import { pixelLength } from '@lawha/scene-graph/text'

import { getCanvasKit } from '#core/canvaskit'
import { exportPDFDocument } from '#core/io/formats/pdf'
import { preparePagesForPDF } from '#core/io/formats/pdf/prepare'
import { exportPrintPDF } from '#core/io/formats/pdf/print'
import { withTextShaper } from '#core/io/shaping'
import { fontManager } from '#core/text/font/manager'

setDefaultTimeout(120_000)

const io = new IORegistry(BUILTIN_IO_FORMATS)
const NASKH = 'Noto Naskh Arabic'
/** Shadda over a letter with fatha over the shadda, and dammatan: marks stacked by GPOS. */
const VOCALIZED = 'شَدَّةٌ مُحَمَّدٌ'
const BLACK: Fill = { type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 1, visible: true }

beforeAll(async () => {
  const inter = expectDefined(await fontManager.fetchBundledFont('/InterVariable.ttf'), 'Inter')
  await fontManager.markLoaded('Inter', 'Regular', inter)
  const naskh = expectDefined(
    await fontManager.fetchBundledFont('/NotoNaskhArabic-Regular.ttf'),
    NASKH
  )
  await fontManager.markLoaded(NASKH, 'Regular', naskh)
})

function page(...texts: Array<Partial<SceneNode>>) {
  const graph = new SceneGraph()
  const pageId = graph.getPages()[0].id
  const frame = graph.createNode('FRAME', pageId, { name: 'Card', width: 500, height: 300 })
  const nodes = texts.map((props) =>
    graph.createNode('TEXT', frame.id, {
      fontFamily: 'Inter',
      fontSize: 28,
      fills: [BLACK],
      textAutoResize: 'WIDTH_AND_HEIGHT',
      ...props
    })
  )
  return { graph, pageId, frame, nodes, spec: { pageId, nodeIds: [frame.id], label: 'Card' } }
}

async function exported(scene: ReturnType<typeof page>) {
  return expectDefined(
    await exportPDFDocument(scene.graph, [scene.spec], { embedFonts: true, layOutPages: true }),
    'PDF'
  )
}

/** The decoded content streams of every page. */
async function contents(data: Uint8Array): Promise<string> {
  const pdf = await PDFDocument.load(data)
  return pdf
    .getPages()
    .flatMap((pdfPage) => {
      const entry = pdfPage.node.Contents()
      const streams: PDFObject[] = entry instanceof PDFArray ? entry.asArray() : []
      if (entry && !(entry instanceof PDFArray)) streams.push(entry)
      return streams
    })
    .map((ref) => pdf.context.lookup(ref))
    .filter((stream): stream is PDFRawStream => stream instanceof PDFRawStream)
    .map((stream) => new TextDecoder('latin1').decode(decodePDFRawStream(stream).decode()))
    .join('\n')
}

/** The glyph IDs the content shows, in the order it shows them. */
const shownGlyphs = (content: string) =>
  [...content.matchAll(/<([0-9A-F]{4})>/g)].map((match) => Number.parseInt(match[1] ?? '', 16))

/** Text layers of a PDF as Lawha opens it again. */
async function reopened(data: Uint8Array): Promise<SceneNode[]> {
  const { graph } = await io.readDocument({ name: 'card.pdf', data })
  const texts: SceneNode[] = []
  const walk = (id: string) => {
    const node = graph.getNode(id)
    if (!node) return
    if (node.type === 'TEXT') texts.push(node)
    node.childIds.forEach(walk)
  }
  for (const each of graph.getPages()) walk(each.id)
  return texts
}

describe('design PDF text', () => {
  test('shows the glyphs the canvas laid out, marks and all, in fonts embedded by glyph ID', async () => {
    const scene = page({ text: VOCALIZED, fontFamily: NASKH, fontSize: 40 })
    const result = await exported(scene)
    const content = await contents(result.data)
    await preparePagesForPDF(scene.graph, [scene.spec])
    const ck = await getCanvasKit()
    const canvas = await withTextShaper(ck, async (_shape, place) =>
      expectDefined(place(scene.nodes[0]), 'placed text').glyphs.map((glyph) => glyph.id)
    )
    // Every glyph the canvas drew, the marks GPOS stacked over their letters included, and no
    // presentation form or mark of jsPDF's own.
    expect(shownGlyphs(content).toSorted((a, b) => a - b)).toEqual(canvas.toSorted((a, b) => a - b))
    expect(content).toContain(' Ts')
    expect(new TextDecoder('latin1').decode(result.data)).toContain('/Identity-H')
    expect(result.fonts?.embedded).toContain(`${NASKH} Regular`)
  })

  test('opens again as the text it spells, marks on their letters', async () => {
    const result = await exported(page({ text: VOCALIZED, fontFamily: NASKH, fontSize: 40 }))
    const [layer] = await reopened(result.data)
    expect(layer?.text.normalize('NFD')).toBe(VOCALIZED.normalize('NFD'))
  })

  test('a letter an Arabic font draws from a shared skeleton reads as itself', async () => {
    // Medial yeh and teh share one dotless skeleton in Noto Naskh Arabic, told apart by dots.
    const words = 'عربية تلتف'
    const result = await exported(page({ text: words, fontFamily: NASKH }))
    const [layer] = await reopened(result.data)
    expect(layer?.text).toBe(words)
  })

  test('a line mixing scripts and fonts reads in logical order, Latin with its spacing', async () => {
    const text = 'Founded شركة القمة (Al-Qimma) in 1999'
    const arabic = { start: 8, length: 10, style: { fontFamily: NASKH } }
    const result = await exported(page({ text, styleRuns: [arabic] }))
    const [layer] = await reopened(result.data)
    expect(layer?.text).toBe(text)
  })

  test('tracked text keeps each letter where the canvas spaced it', async () => {
    const scene = page({ text: 'TRACKED', letterSpacing: pixelLength(10) })
    const result = await exported(scene)
    const ck = await getCanvasKit()
    const glyphs = await withTextShaper(ck, async (_shape, place) =>
      expectDefined(place(scene.nodes[0]), 'placed text').glyphs.map((glyph) => glyph.x)
    )
    const [layer] = await reopened(result.data)
    expect(layer?.text).toBe('TRACKED')
    // The letters keep the canvas's spacing, which the reopened layer reads back as tracking.
    const gaps = glyphs.slice(1).map((x, index) => x - (glyphs[index] ?? 0))
    expect(layer?.letterSpacing.unit).toBe('PIXELS')
    expect(layer?.letterSpacing.value).toBeCloseTo(10, 0)
    expect(gaps.every((gap) => gap > 10)).toBe(true)
  })

  test('turned and clipped text keeps its transform, inside its frame’s clip', async () => {
    const scene = page({ text: 'Turned', rotation: 30, x: 100, y: 100 })
    scene.graph.updateNode(scene.frame.id, { clipsContent: true })
    const result = await exported(scene)
    const [layer] = await reopened(result.data)
    expect(layer?.text).toBe('Turned')
    expect(Math.round(layer?.rotation ?? 0)).toBe(30)
    expect(await contents(result.data)).toMatch(/W\s+n[\s\S]*LawhaF1/)
  })

  test('a gradient fills the glyphs’ outlines, over text that stays selectable', async () => {
    const gradient: Fill = {
      type: 'GRADIENT_LINEAR',
      color: { r: 0, g: 0, b: 0, a: 1 },
      opacity: 1,
      visible: true,
      gradientStops: [
        { position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
        { position: 1, color: { r: 0, g: 0, b: 1, a: 1 } }
      ],
      gradientTransform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 }
    }
    const stroke = { ...BLACK, weight: 2, align: 'CENTER' as const }
    const result = await exported(page({ text: 'Fade', fills: [gradient], strokes: [stroke] }))
    const content = await contents(result.data)
    expect(content).toContain('/Sh1 sh')
    expect(content).toContain('3 Tr')
    expect(content).toMatch(/\nS\n/)
    const [layer] = await reopened(result.data)
    expect(layer?.text).toBe('Fade')
  })

  test('embeds only the glyphs drawn, of each weight’s instance', async () => {
    const result = await exported(
      page({ text: 'Bold', fontWeight: 700 }, { text: 'Light', fontWeight: 300, y: 60 })
    )
    expect(result.fonts?.embedded.filter((face) => face.startsWith('Inter'))).toHaveLength(2)
    // Two subsets of Inter, not two copies of an 880 KB variable font.
    expect(result.data.length).toBeLessThan(120_000)
  })

  test('prints in CMYK with its fonts embedded, as PDF/X asks', async () => {
    const scene = page({ text: VOCALIZED, fontFamily: NASKH }, { text: 'Latin', y: 80 })
    scene.graph.updateNode(scene.frame.id, {
      fills: [{ ...BLACK, color: { r: 1, g: 1, b: 1, a: 1 } }]
    })
    const result = expectDefined(await exportPrintPDF(scene.graph, [scene.spec]), 'print PDF')
    expect(result.issues).toEqual([])
    const content = new TextDecoder('latin1').decode(result.data)
    expect(content).toMatch(/BT \/LawhaF\d+ [\d.]+ Tf\n0 0 0 1 k/)
    const texts = (await reopened(result.data)).map((layer) => layer.text)
    expect(texts.map((text) => text.normalize('NFD'))).toContain(VOCALIZED.normalize('NFD'))
  })
})
