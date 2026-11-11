import type { CanvasKit } from 'canvaskit-wasm'
import { fromUint8Array } from 'js-base64'
import type * as PDFJS from 'pdfjs-dist/legacy/build/pdf.mjs'

import { SceneGraph } from '@lawha/scene-graph'

import { getCanvasKit } from '#core/canvaskit'
import { createCanvasKitRasterCodec } from '#core/io/formats/raster'
import { createSVGNodes } from '#core/io/formats/svg/import'

import { pdfPageToSVG, type PDFImage, type PDFOps } from './svg'

/**
 * PDF, and Illustrator `.ai` files (a PDF inside), as editable layers: each page becomes a frame
 * of its size holding its paths, live text and images, laid out side by side on one page.
 */
export interface PDFReadOptions {
  canvasKit?: CanvasKit
  name?: string
  /** At most this many pages; very long PDFs are rarely design files. Default 50. */
  maxPages?: number
}

const PAGE_GAP = 100

/** pdf.js decoded image kinds. */
const GRAYSCALE_1BPP = 1
const RGB_24BPP = 2

interface DecodedImage {
  width: number
  height: number
  kind?: number
  data?: Uint8Array | Uint8ClampedArray
}

function toRGBA(image: DecodedImage): Uint8Array | null {
  const { width, height, data } = image
  if (!data) return null
  const out = new Uint8Array(width * height * 4)
  if (image.kind === RGB_24BPP) {
    for (let p = 0, q = 0; p < width * height; p++, q += 3) {
      out.set([data[q], data[q + 1], data[q + 2], 255], p * 4)
    }
  } else if (image.kind === GRAYSCALE_1BPP) {
    const rowBytes = (width + 7) >> 3
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const bit = (data[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1
        const v = bit ? 255 : 0
        out.set([v, v, v, 255], (y * width + x) * 4)
      }
    }
  } else {
    out.set(data.subarray(0, out.length))
  }
  return out
}

let pdfjsLoading: Promise<typeof PDFJS> | null = null

/**
 * pdf.js, with its worker code run on this thread: it then needs no worker file, so the same
 * import works in the browser, the desktop app and headless.
 */
function loadPDFJS() {
  pdfjsLoading ??= (async () => {
    const worker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs')
    Reflect.set(globalThis, 'pdfjsWorker', worker)
    return import('pdfjs-dist/legacy/build/pdf.mjs')
  })()
  return pdfjsLoading
}

type PDFPage = Awaited<
  ReturnType<Awaited<ReturnType<typeof PDFJS.getDocument>['promise']>['getPage']>
>

/** A page as SVG, its images encoded as PNG. */
function pageSVG(
  page: PDFPage,
  ops: PDFOps,
  codec: ReturnType<typeof createCanvasKitRasterCodec>
): Promise<string> {
  return pdfPageToSVG(page, {
    ops,
    image: (name) =>
      new Promise<PDFImage | null>((resolve) => {
        const store = name.startsWith('g_') ? page.commonObjs : page.objs
        store.get(name, (image: DecodedImage | null) => {
          const rgba = image ? toRGBA(image) : null
          const png =
            rgba && image
              ? codec.encodePNG({ width: image.width, height: image.height, data: rgba })
              : null
          resolve(
            png && image
              ? {
                  width: image.width,
                  height: image.height,
                  href: `data:image/png;base64,${fromUint8Array(png)}`
                }
              : null
          )
        })
      })
  })
}

function openPDF(pdfjs: typeof PDFJS, bytes: Uint8Array) {
  return pdfjs.getDocument({
    data: bytes.slice(),
    useWorkerFetch: false,
    isEvalSupported: false,
    disableFontFace: true,
    isOffscreenCanvasSupported: false,
    verbosity: 0
  }).promise
}

/** A page drawn as SVG, in PDF points, as previews show it. */
export interface PDFPagePreview {
  svg: string
  width: number
  height: number
}

/** The pages of a PDF as SVG, up to `maxPages`, such as to place a signature on one. */
export async function previewPDFPages(
  bytes: Uint8Array,
  options: { canvasKit?: CanvasKit; maxPages?: number } = {}
): Promise<PDFPagePreview[]> {
  const pdfjs = await loadPDFJS()
  const codec = createCanvasKitRasterCodec(options.canvasKit ?? (await getCanvasKit()))
  const doc = await openPDF(pdfjs, bytes)
  const ops: PDFOps = { ...pdfjs.OPS }
  const previews: PDFPagePreview[] = []
  try {
    const count = Math.min(doc.numPages, options.maxPages ?? 50)
    for (let index = 1; index <= count; index++) {
      const page = await doc.getPage(index)
      const { width, height } = page.getViewport({ scale: 1 })
      previews.push({ svg: await pageSVG(page, ops, codec), width, height })
      page.cleanup()
    }
  } finally {
    await doc.destroy()
  }
  return previews
}

export async function readPDFDocument(
  bytes: Uint8Array,
  options: PDFReadOptions = {}
): Promise<SceneGraph> {
  const pdfjs = await loadPDFJS()
  const ck = options.canvasKit ?? (await getCanvasKit())
  const codec = createCanvasKitRasterCodec(ck)
  const doc = await openPDF(pdfjs, bytes)

  const graph = new SceneGraph()
  const pageId = graph.getPages()[0].id
  const ops: PDFOps = { ...pdfjs.OPS }
  const count = Math.min(doc.numPages, options.maxPages ?? 50)
  let x = 0
  try {
    for (let index = 1; index <= count; index++) {
      const page = await doc.getPage(index)
      const svg = await pageSVG(page, ops, codec)
      const label = count > 1 ? `${options.name ?? 'PDF'} — ${index}` : (options.name ?? 'PDF')
      const frame = createSVGNodes(graph, pageId, svg, { name: label, x, y: 0, keepEmpty: true })
      x += (frame?.width ?? page.getViewport({ scale: 1 }).width) + PAGE_GAP
      page.cleanup()
    }
  } finally {
    await doc.destroy()
  }
  return graph
}
