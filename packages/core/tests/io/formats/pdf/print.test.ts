import { describe, expect, setDefaultTimeout, test } from 'bun:test'

import { expectDefined } from '#core-tests/helpers/assert'
import { deflateSync, inflateSync } from 'fflate'

import { BUILTIN_IO_FORMATS, IORegistry } from '@lawha/core/io'
import { SceneGraph, type Fill } from '@lawha/scene-graph'
import { EXPORT_FORMAT_IDS } from '@lawha/scene-graph/export-format'

import { artworkBleed, DIELINE_SPOTS, limitInk, rgbToCMYK } from '#core/io/formats/pdf/print'
import { rewriteContent } from '#core/io/formats/pdf/print/content'
import { convertToPrintPDF } from '#core/io/formats/pdf/print/convert'
import { latin1, latin1Bytes, parsePDF } from '#core/io/formats/pdf/print/file'
import {
  createProfileTransform,
  loadPressProfile,
  parseICCProfile,
  profileColor
} from '#core/io/formats/pdf/print/icc'
import { convertImage } from '#core/io/formats/pdf/print/images'

setDefaultTimeout(120_000)

const io = new IORegistry(BUILTIN_IO_FORMATS)
const MM = 72 / 25.4

function solid(r: number, g: number, b: number, a = 1): Fill {
  return { type: 'SOLID', color: { r, g, b, a }, opacity: 1, visible: true }
}

/** A 200 × 100 pt card: a red square, a blue gradient, a cut line in CutContour, and text. */
function card() {
  const graph = new SceneGraph()
  const pageId = graph.getPages()[0].id
  const frame = graph.createNode('FRAME', pageId, {
    name: 'Card',
    width: 200,
    height: 100,
    fills: [solid(1, 1, 0.8)],
    clipsContent: true
  })
  graph.createNode('RECTANGLE', frame.id, {
    x: 10,
    y: 10,
    width: 40,
    height: 40,
    fills: [solid(1, 0, 0)]
  })
  graph.createNode('RECTANGLE', frame.id, {
    x: 60,
    y: 10,
    width: 40,
    height: 40,
    fills: [
      {
        type: 'GRADIENT_LINEAR',
        color: { r: 0, g: 0, b: 0, a: 1 },
        opacity: 1,
        visible: true,
        gradientStops: [
          { position: 0, color: { r: 0, g: 0, b: 1, a: 1 } },
          { position: 1, color: { r: 0, g: 1, b: 0, a: 1 } }
        ],
        gradientTransform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 }
      }
    ]
  })
  graph.createNode('RECTANGLE', frame.id, {
    name: 'CutContour',
    x: 5,
    y: 5,
    width: 190,
    height: 90,
    fills: [],
    strokes: [{ ...solid(0.925, 0, 0.549), weight: 0.5, align: 'CENTER' }]
  })
  graph.createNode('TEXT', frame.id, {
    x: 110,
    y: 20,
    width: 80,
    height: 20,
    text: 'Print',
    fontFamily: 'Inter',
    fontSize: 14,
    fills: [solid(0, 0, 0)]
  })
  return { graph, frame }
}

async function exportPrint(graph: SceneGraph, nodeIds: string[], options?: object) {
  const result = await io.exportContent(
    'pdf-print',
    { graph, target: { scope: 'selection', nodeIds } },
    options
  )
  if (typeof result.data === 'string') throw new Error('PDF is binary')
  return result
}

function numbers(text: string | undefined) {
  return (text ?? '').trim().split(/\s+/).map(Number)
}

describe('print PDF export', () => {
  test('is an export format of its own', () => {
    expect(EXPORT_FORMAT_IDS).toContain('pdf-print')
    expect(io.listExportFormats('node').some((format) => format.id === 'pdf-print')).toBe(true)
  })

  test('writes CMYK, spot inks, trim and bleed boxes, crop marks and an output intent', async () => {
    const { graph, frame } = card()
    const result = await exportPrint(graph, [frame.id])
    const data = result.data as Uint8Array
    const pdf = latin1(data)
    expect(pdf.startsWith('%PDF-1.4')).toBe(true)
    const file = parsePDF(data)

    // The sheet: 3 mm bleed and room for the marks around the 200 × 100 trim.
    const page = expectDefined(
      [...file.objects.values()].find((o) => /\/Type\s*\/Page\b/.test(o.dict))
    )
    const media = numbers(/\/MediaBox\s*\[([^\]]*)\]/.exec(page.dict)?.[1])
    const trim = numbers(/\/TrimBox\s*\[([^\]]*)\]/.exec(page.dict)?.[1])
    const bleed = numbers(/\/BleedBox\s*\[([^\]]*)\]/.exec(page.dict)?.[1])
    expect(trim[2] - trim[0]).toBeCloseTo(200, 1)
    expect(trim[3] - trim[1]).toBeCloseTo(100, 1)
    expect(bleed[2] - bleed[0]).toBeCloseTo(200 + 6 * MM, 1)
    expect(bleed[3] - bleed[1]).toBeCloseTo(100 + 6 * MM, 1)
    expect(media[2] - media[0]).toBeGreaterThan(bleed[2] - bleed[0] + 30)

    // No RGB left: colours are CMYK operators, the gradient a CMYK shading.
    expect(pdf).not.toContain('/DeviceRGB')
    const contents = [...file.objects.values()]
      .filter(
        (o) =>
          o.stream &&
          /\/Length/.test(o.dict) &&
          !/\/Subtype|\/FunctionType|\/Type\s*\/Metadata|\/Length1/.test(o.dict)
      )
      .map((o) => latin1(o.stream ?? new Uint8Array()))
      .join('\n')
    expect(contents).not.toMatch(/\brg\b|\bRG\b/)
    // The red square through the FOGRA39 profile: magenta and yellow, no cyan or black.
    const fills = [...contents.matchAll(/([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) k\b/g)].map((m) =>
      m.slice(1, 5).map(Number)
    )
    expect(
      fills.some(([c, m, y, k]) => c < 0.02 && m > 0.9 && m < 0.99 && y > 0.9 && k < 0.02)
    ).toBe(true)
    // Black text prints in black ink alone.
    expect(contents).toContain('0 0 0 1 k')
    expect(pdf).toMatch(/\/ShadingType 2\s*\/ColorSpace \/DeviceCMYK/)

    // The cut line is the CutContour ink; the crop marks print on every plate.
    expect(pdf).toContain('/Separation /CutContour /DeviceCMYK')
    expect(pdf).toContain('/Separation /All /DeviceCMYK')
    expect(contents).toMatch(/\/LawhaSpot\d+ CS 1 SCN/)

    // PDF/X: the press condition, its version, trapping, and the text's font embedded.
    expect(pdf).toContain('/OutputConditionIdentifier (FOGRA39)')
    // The profile colours were converted with is embedded with the output intent.
    const intent = expectDefined(
      [...file.objects.values()].find((o) => /\/Type\s*\/OutputIntent/.test(o.dict))
    )
    const profileRef = Number(/\/DestOutputProfile (\d+) 0 R/.exec(intent.dict)?.[1])
    const profile = expectDefined(file.objects.get(profileRef)?.stream)
    expect(latin1(profile.subarray(36, 40))).toBe('acsp')
    expect(parseICCProfile(profile)?.description).toBe('FOGRA39L Coated')
    expect(pdf).toContain('/S /GTS_PDFX')
    expect(pdf).toContain('/Trapped /False')
    expect(result.warnings).toBeUndefined()
    expect(pdf).toContain('/GTS_PDFXVersion (PDF/X-1a:2003)')
    expect(pdf).toContain('<pdfxid:GTS_PDFXVersion>PDF/X-1a:2003</pdfxid:GTS_PDFXVersion>')
    expect(pdf).toMatch(/\/FontFile2/)
  })

  test('opens again in a PDF reader, with its CMYK drawn', async () => {
    const { graph, frame } = card()
    const data = (await exportPrint(graph, [frame.id])).data as Uint8Array
    const { readPDFDocument } = await import('#core/io/formats/pdf/import')
    const reread = await readPDFDocument(data)
    const page = reread.getChildren(reread.getPages()[0].id)[0]
    expect(page.width).toBeGreaterThan(200)
    // Somewhere in the sheet the red square: pdf.js draws CMYK 0 1 1 0 back as a warm red.
    const layers = [...reread.nodes.values()]
    expect(
      layers.some((layer) =>
        layer.fills.some(
          (fill) =>
            fill.type === 'SOLID' && fill.color.r > 0.9 && fill.color.g < 0.3 && fill.color.b < 0.3
        )
      )
    ).toBe(true)
  })

  test('without bleed or marks the sheet is the trim', async () => {
    const { graph, frame } = card()
    const data = (await exportPrint(graph, [frame.id], { bleed: 0, cropMarks: false }))
      .data as Uint8Array
    const page = expectDefined(
      [...parsePDF(data).objects.values()].find((o) => /\/Type\s*\/Page\b/.test(o.dict))
    )
    expect(numbers(/\/MediaBox\s*\[([^\]]*)\]/.exec(page.dict)?.[1])).toEqual([0, 0, 200, 100])
    expect(numbers(/\/TrimBox\s*\[([^\]]*)\]/.exec(page.dict)?.[1])).toEqual([0, 0, 200, 100])
  })

  test('flattens transparency into an opaque image, so the file is still PDF/X-1a', async () => {
    const { graph, frame } = card()
    graph.createNode('RECTANGLE', frame.id, {
      x: 15,
      y: 15,
      width: 20,
      height: 20,
      opacity: 0.5,
      fills: [solid(0, 0, 1)]
    })
    const result = await exportPrint(graph, [frame.id])
    const pdf = latin1(result.data as Uint8Array)
    expect(result.warnings?.map((warning) => warning.code)).toEqual(['transparency-flattened'])
    expect(result.warnings?.[0]).toMatchObject({ subject: '1' })
    expect(pdf).toContain('/GTS_PDFXVersion (PDF/X-1a:2003)')
    expect(pdf).not.toMatch(/\/ca\s+0\.\d/)
    expect(pdf).not.toMatch(/\/SMask\s+\d/)
    // The flattened area is an image, in CMYK; the rest of the card stays vector.
    expect(pdf).toMatch(/\/Subtype \/Image[\s\S]*?\/ColorSpace \/DeviceCMYK/)
    expect(pdf).toMatch(/\/FontFile2/)
  })

  test('PDF/X-4 keeps transparency live', async () => {
    const { graph, frame } = card()
    graph.createNode('RECTANGLE', frame.id, {
      width: 20,
      height: 20,
      opacity: 0.5,
      fills: [solid(0, 0, 1)]
    })
    const result = await exportPrint(graph, [frame.id], { standard: 'PDF/X-4' })
    const pdf = latin1(result.data as Uint8Array)
    expect(pdf.startsWith('%PDF-1.6')).toBe(true)
    expect(result.warnings).toBeUndefined()
    expect(pdf).toContain('/GTS_PDFXVersion (PDF/X-4)')
    expect(pdf).toMatch(/\/ca\s+0\.5/)
  })

  test('a print template that holds its bleed is not given bleed again', async () => {
    const graph = new SceneGraph()
    const pageId = graph.getPages()[0].id
    const bleed = 3 * MM
    // As create_print_template builds one: 200 × 100 pt trim plus bleed, its die-line inside.
    const sheet = graph.createNode('FRAME', pageId, {
      name: 'Card',
      width: 200 + 2 * bleed,
      height: 100 + 2 * bleed,
      fills: [],
      clipsContent: false
    })
    graph.createNode('FRAME', sheet.id, {
      name: 'Artwork',
      width: sheet.width,
      height: sheet.height,
      fills: [solid(0.2, 0.4, 0.8)]
    })
    const dieline = graph.createNode('FRAME', sheet.id, {
      name: 'Dieline (do not print)',
      width: sheet.width,
      height: sheet.height,
      fills: []
    })
    graph.createNode('VECTOR', dieline.id, {
      name: 'Bleed',
      width: sheet.width,
      height: sheet.height
    })
    graph.createNode('VECTOR', dieline.id, {
      name: 'CutContour',
      x: bleed,
      y: bleed,
      width: 200,
      height: 100,
      strokes: [{ ...solid(0.925, 0, 0.549), weight: 0.5, align: 'CENTER' }]
    })
    const result = await exportPrint(graph, [sheet.id])
    const page = expectDefined(
      [...parsePDF(result.data as Uint8Array).objects.values()].find((o) =>
        /\/Type\s*\/Page\b/.test(o.dict)
      )
    )
    const trim = numbers(/\/TrimBox\s*\[([^\]]*)\]/.exec(page.dict)?.[1])
    const bleedBox = numbers(/\/BleedBox\s*\[([^\]]*)\]/.exec(page.dict)?.[1])
    expect(trim[2] - trim[0]).toBeCloseTo(200, 1)
    expect(trim[3] - trim[1]).toBeCloseTo(100, 1)
    expect(bleedBox[2] - bleedBox[0]).toBeCloseTo(200 + 2 * bleed, 1)
    expect(result.warnings?.map((warning) => warning.code)).toContain('bleed-in-artwork')
    expect(artworkBleed(graph, sheet.id)).toBeCloseTo(bleed, 3)
  })

  test('named spot colours become Separations', async () => {
    const { graph, frame } = card()
    graph.createNode('RECTANGLE', frame.id, {
      x: 120,
      y: 60,
      width: 30,
      height: 30,
      fills: [solid(0.85, 0.1, 0.2)]
    })
    const data = (
      await exportPrint(graph, [frame.id], {
        spotColors: [
          { name: 'PANTONE 185 C', color: { r: 0.85, g: 0.1, b: 0.2 }, cmyk: [0, 0.91, 0.76, 0] }
        ]
      })
    ).data as Uint8Array
    const pdf = latin1(data)
    expect(pdf).toContain('/Separation /PANTONE#20185#20C /DeviceCMYK')
    expect(pdf).toContain('/C1 [0 0.91 0.76 0]')
  })
})

describe('print PDF colour conversion', () => {
  test('RGB to CMYK puts the grey in black', () => {
    expect(rgbToCMYK(1, 0, 0)).toEqual([0, 1, 1, 0])
    expect(rgbToCMYK(0, 0, 0)).toEqual([0, 0, 0, 1])
    expect(rgbToCMYK(1, 1, 1)).toEqual([0, 0, 0, 0])
    const [c, m, y, k] = rgbToCMYK(0.5, 0.5, 0.5)
    expect([c, m, y]).toEqual([0, 0, 0])
    expect(k).toBeCloseTo(0.5, 6)
  })

  test('rewrites colour operators and leaves strings alone', () => {
    const rewritten = rewriteContent(
      '1. 0. 0. rg 0 0 1 RG 0.5 g BT /F1 12 Tf (1 0 0 rg) Tj ET 0.925 0. 0.549 RG',
      [DIELINE_SPOTS.cut]
    )
    expect(rewritten.text).toBe(
      '0 1 1 0 k 1 1 0 0 K 0 0 0 0.5 k BT /F1 12 Tf (1 0 0 rg) Tj ET /LawhaSpot1 CS 1 SCN'
    )
    expect([...rewritten.spotsUsed]).toEqual([0])
    expect([...rewritten.fontsUsed]).toEqual(['F1'])
  })

  test('converts PNG-predicted RGB images and indexed palettes', () => {
    // Two red pixels, one row, filtered with Sub (each pixel minus its left neighbour).
    const rows = new Uint8Array([1, 255, 0, 0, 0, 0, 0])
    const image = convertImage({
      dict: '<< /Type /XObject /Subtype /Image /Width 2 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /DecodeParms << /Predictor 15 /Colors 3 /BitsPerComponent 8 /Columns 2 >> >>',
      stream: deflateSync(rows)
    })
    const converted = expectDefined(image)
    expect(converted.dict).toContain('/ColorSpace /DeviceCMYK')
    expect(converted.dict).not.toContain('DecodeParms')
    expect([...inflateSync(expectDefined(converted.stream))]).toEqual([
      0, 255, 255, 0, 0, 255, 255, 0
    ])

    const indexed = expectDefined(
      convertImage({
        dict: '<< /Subtype /Image /Width 1 /Height 1 /ColorSpace [/Indexed /DeviceRGB 1 <FF0000 000000>] /BitsPerComponent 8 >>',
        stream: new Uint8Array([0])
      })
    )
    expect(indexed.dict).toContain('[/Indexed /DeviceCMYK 1 <00FFFF00000000FF>]')
  })

  test('a whole file keeps a readable cross-reference table', () => {
    const content = '1 0 0 rg 0 0 10 10 re f'
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 50 50] /Contents 4 0 R /Resources 5 0 R >>',
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
      '<< /ProcSet [/PDF] >>',
      '<< /Producer (test) /CreationDate (D:20260101000000Z) >>'
    ]
    let pdf = '%PDF-1.3\n'
    objects.forEach((object, i) => {
      pdf += `${i + 1} 0 obj\n${object}\nendobj\n`
    })
    pdf += 'xref\n0 7\ntrailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\nstartxref\n0\n%%EOF\n'
    const result = convertToPrintPDF(latin1Bytes(pdf), {
      spots: [],
      outputIntent: 'FOGRA39',
      bleedInset: 0,
      trimInset: 5,
      title: 'لوحة'
    })
    const text = latin1(result.data)
    expect(result.pdfx).toBe('PDF/X-1a:2003')
    expect(text).toContain('/TrimBox [5 5 45 45]')
    expect(text).toContain('0 1 1 0 k')
    // The title is UTF-16, as PDF text strings that are not ASCII are.
    expect(text).toContain('/Title <FEFF06440648062D0629>')
    // Every offset the table gives starts its object.
    const xref = text.slice(text.lastIndexOf('xref'))
    const offsets = [...xref.matchAll(/^(\d{10}) 00000 n $/gm)].map((match) => Number(match[1]))
    offsets.forEach((offset, index) => {
      expect(text.slice(offset).startsWith(`${index + 1} 0 obj`)).toBe(true)
    })
    const startxref = Number(/startxref\n(\d+)/.exec(text)?.[1])
    expect(text.slice(startxref).startsWith('xref')).toBe(true)
  })

  test('reads the bundled FOGRA39 profile and converts through its tables', async () => {
    const loaded = await loadPressProfile('FOGRA39')
    const profile = expectDefined(loaded.profile)
    const parsed = expectDefined(parseICCProfile(profile.bytes))
    expect(parsed).toMatchObject({ deviceClass: 'prtr', colorSpace: 'CMYK', pcs: 'Lab ' })
    expect(Object.keys(parsed.toDevice).sort()).toEqual(['perceptual', 'relative', 'saturation'])
    // sRGB red, green and blue as the press prints them, not the device formula's pure inks.
    const [c, m, y, k] = profile.toCMYK(1, 0, 0)
    expect(c).toBeLessThan(0.02)
    expect(m).toBeGreaterThan(0.9)
    expect(y).toBeGreaterThan(0.9)
    expect(k).toBeLessThan(0.02)
    const blue = profile.toCMYK(0, 0, 1)
    expect(blue[0]).toBeGreaterThan(0.85)
    expect(blue[1]).toBeGreaterThan(0.7)
    expect(blue[1]).toBeLessThan(0.95)
    // Black is a rich black within FOGRA39's 330% ink limit; white takes no ink.
    const black = profile.toCMYK(0, 0, 0)
    expect(black[3]).toBeGreaterThan(0.95)
    expect(black.reduce((sum, ink) => sum + ink, 0)).toBeLessThanOrEqual(3.3)
    expect(profile.toCMYK(1, 1, 1)).toEqual([0, 0, 0, 0])
    // The cached grid agrees with the exact conversion between its points.
    for (const rgb of [
      [0.3, 0.6, 0.2],
      [0.9, 0.75, 0.1],
      [0.12, 0.34, 0.56]
    ] as const) {
      const exact = expectDefined(profileColor(parsed, ...rgb))
      profile
        .toCMYK(...rgb)
        .forEach((ink, i) => expect(Math.abs(ink - exact[i])).toBeLessThan(0.01))
    }
  })

  test('a profile that is not a CMYK output profile is refused', async () => {
    const loaded = await loadPressProfile('FOGRA39', new Uint8Array(200))
    expect(loaded).toEqual({ profile: null, reason: 'unreadable' })
    expect(await loadPressProfile('GRACoL2013')).toEqual({ profile: null, reason: 'none-bundled' })
    const parsed = expectDefined(
      parseICCProfile(expectDefined((await loadPressProfile('FOGRA39')).profile).bytes)
    )
    expect(createProfileTransform({ ...parsed, colorSpace: 'RGB ' })).toBeNull()
  })

  test('ink over the limit goes to black first, then comes off the colours', () => {
    const sum = (cmyk: readonly number[]) => cmyk.reduce((a, b) => a + b, 0)
    // 80% grey component moves into black: 3.6 becomes 3.0 without touching the hue.
    const replaced = limitInk([0.9, 0.8, 0.8, 1.1 - 0.1], 3.3)
    expect(sum(replaced)).toBeCloseTo(3.3, 6)
    expect(replaced[3]).toBeGreaterThan(0.99)
    // Black already full: the colours give up the rest evenly.
    const removed = limitInk([0.9, 0.9, 0.9, 1], 2.5)
    expect(sum(removed)).toBeCloseTo(2.5, 6)
    expect(removed[0]).toBeCloseTo(removed[1], 6)
    expect(limitInk([0.2, 0.3, 0, 0], 3.3)).toEqual([0.2, 0.3, 0, 0])
  })

  test('a print export keeps every colour within the ink limit it is given', async () => {
    const { graph, frame } = card()
    graph.createNode('RECTANGLE', frame.id, {
      x: 120,
      y: 60,
      width: 30,
      height: 30,
      fills: [solid(0.05, 0.02, 0.08)]
    })
    const data = (await exportPrint(graph, [frame.id], { inkLimit: 2.4 })).data as Uint8Array
    const fills = [...latin1(data).matchAll(/([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) k\b/g)].map((m) =>
      m.slice(1, 5).reduce((a, b) => a + Number(b), 0)
    )
    expect(fills.length).toBeGreaterThan(0)
    expect(Math.max(...fills)).toBeLessThanOrEqual(2.401)
    // The rich dark colour was over the limit before.
    const loaded = expectDefined((await loadPressProfile('FOGRA39')).profile)
    const before = loaded.toCMYK(0.05, 0.02, 0.08).reduce((a, b) => a + b, 0)
    expect(before).toBeGreaterThan(2.4)
  })
})
