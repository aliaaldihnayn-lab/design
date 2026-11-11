import { describe, expect, setDefaultTimeout, test } from 'bun:test'
import { readFileSync } from 'node:fs'

import { corePackagePath } from '#core-tests/helpers/paths'
import { PDFDocument, PDFName, PDFRawStream } from '@cantoo/pdf-lib'
import { fromUint8Array } from 'js-base64'

import {
  canvasKitImageConverter,
  createWriterDocument,
  exportWriterPDF,
  type WriterNode
} from '@lawha/core/writer'

import { getCanvasKit } from '#core/canvaskit'

setDefaultTimeout(120_000)

const INTER = readFileSync(corePackagePath('assets', 'InterVariable.ttf'))
const fonts = async () => INTER.buffer.slice(INTER.byteOffset, INTER.byteOffset + INTER.byteLength)

/** A 30×20 WebP from CanvasKit. */
async function webp(): Promise<Uint8Array> {
  const ck = await getCanvasKit()
  const surface = ck.MakeSurface(30, 20)
  if (!surface) throw new Error('no surface')
  surface.getCanvas().clear(ck.Color(200, 30, 30, 1))
  const image = surface.makeImageSnapshot()
  const bytes = image.encodeToBytes(ck.ImageFormat.WEBP, 90)
  image.delete()
  surface.delete()
  if (!bytes) throw new Error('no WebP')
  return bytes
}

/** A 2×2 one-frame GIF, written byte by byte (GIF89a, global colour table of two). */
const GIF = new Uint8Array([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 2, 0, 2, 0, 0x80, 0, 0, 0xff, 0, 0, 0, 0, 0xff, 0x2c, 0, 0, 0,
  0, 2, 0, 2, 0, 0, 2, 2, 0x84, 0x51, 0, 0x3b
])

const imageDoc = (src: string) => {
  const body: WriterNode = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'image', attrs: { src, width: 40, height: 30 } }]
      }
    ]
  }
  return createWriterDocument({ body })
}

async function imageCount(pdf: Uint8Array): Promise<number> {
  const loaded = await PDFDocument.load(pdf)
  return loaded.context
    .enumerateIndirectObjects()
    .filter(
      ([, object]) =>
        object instanceof PDFRawStream &&
        object.dict.get(PDFName.of('Subtype')) === PDFName.of('Image')
    ).length
}

describe('PDF export of pictures PDF cannot hold', () => {
  test.each([
    ['WebP', 'image/webp', webp],
    ['GIF', 'image/gif', async () => GIF]
  ])('a %s goes in as PNG', async (_, mime, bytes) => {
    const src = `data:${mime};base64,${fromUint8Array(await bytes())}`
    const convertImage = canvasKitImageConverter(await getCanvasKit())
    expect(await imageCount(await exportWriterPDF(imageDoc(src), { fonts, convertImage }))).toBe(1)
    // Without a converter it is left out rather than breaking the export.
    expect(await imageCount(await exportWriterPDF(imageDoc(src), { fonts }))).toBe(0)
  })
})
