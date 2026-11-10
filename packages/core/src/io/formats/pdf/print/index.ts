import type { CanvasKit } from 'canvaskit-wasm'

import type { SceneGraph } from '@lawha/scene-graph'

import { getCanvasKit } from '#core/canvaskit'
import { exportPDFDocument } from '#core/io/formats/pdf/document'
import type { PDFPageSpec } from '#core/io/formats/pdf/plan'
import { createCanvasKitRasterCodec } from '#core/io/formats/raster'
import { extractExportGraph } from '#core/io/subgraph'

import {
  DIELINE_SPOTS,
  REGISTRATION_SPOT,
  type PDFOutputIntentId,
  type PDFSpotColor
} from './color'
import { convertToPrintPDF, type PrintConversionResult } from './convert'
import { latin1 } from './file'
import { composePrintSheet, markMargin } from './sheet'

export {
  DIELINE_SPOTS,
  PDF_OUTPUT_INTENTS,
  rgbToCMYK,
  type CMYK,
  type PDFOutputIntentId,
  type PDFSpotColor
} from './color'

/** 3 mm, the bleed most printers ask for. */
export const DEFAULT_PRINT_BLEED = (3 / 25.4) * 72

export interface PDFPrintOptions {
  /** Points of artwork past the trim on every side; default 3 mm. */
  bleed?: number
  /** Crop marks at the trim's corners, in registration colour; default on. */
  cropMarks?: boolean
  /** The press condition; default FOGRA39 (ISO coated, Europe). */
  outputIntent?: PDFOutputIntentId
  /** The condition's ICC profile, embedded in the output intent; with one the file is PDF/X-4. */
  outputProfile?: Uint8Array
  /** Inks printed apart: layers painted in their colour print as that ink. Die-line inks always. */
  spotColors?: readonly PDFSpotColor[]
  title?: string
  /** Decodes JPEG images to convert them; without it CanvasKit is loaded when one is there. */
  canvasKit?: CanvasKit
}

export type PDFPrintResult = PrintConversionResult

/**
 * A press-ready PDF of the pages: one page per spec on a sheet with bleed and crop marks, fonts
 * embedded, every colour in CMYK or a spot ink, trim and bleed boxes set, and the press condition
 * as its output intent (PDF/X-1a, or PDF/X-4 with a profile). Null when nothing is visible.
 */
export async function exportPrintPDF(
  graph: SceneGraph,
  specs: readonly PDFPageSpec[],
  options: PDFPrintOptions = {}
): Promise<PDFPrintResult | null> {
  const layout = {
    bleed: options.bleed ?? DEFAULT_PRINT_BLEED,
    cropMarks: options.cropMarks ?? true
  }
  // Layers draw past their own box into the bleed, so on a copy the pages' top layers stop
  // clipping there.
  const { graph: copy } = extractExportGraph(graph, {
    scope: 'selection',
    nodeIds: specs.flatMap((spec) => spec.nodeIds)
  })
  for (const spec of specs) {
    for (const id of spec.nodeIds) {
      if (copy.getNode(id)?.clipsContent) copy.updateNode(id, { clipsContent: false })
    }
  }
  const pdf = await exportPDFDocument(copy, specs, {
    embedFonts: true,
    title: options.title,
    print: { compress: false, composePage: composePrintSheet(copy, layout) }
  })
  if (!pdf) return null
  // JPEG images are decoded to convert them, through CanvasKit, loaded only when one is there.
  const hasJPEG = latin1(pdf.data).includes('/DCTDecode')
  const ck = hasJPEG ? (options.canvasKit ?? (await getCanvasKit())) : null
  const codec = ck ? createCanvasKitRasterCodec(ck) : null
  const margin = markMargin(layout)
  return convertToPrintPDF(pdf.data, {
    spots: [
      REGISTRATION_SPOT,
      DIELINE_SPOTS.cut,
      DIELINE_SPOTS.crease,
      ...(options.spotColors ?? [])
    ],
    outputIntent: options.outputIntent ?? 'FOGRA39',
    outputProfile: options.outputProfile,
    bleedInset: margin,
    trimInset: margin + layout.bleed,
    title: options.title,
    decodeImage: codec ? (bytes) => codec.decode(bytes) : undefined
  })
}
