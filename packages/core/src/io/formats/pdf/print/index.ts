import type { CanvasKit } from 'canvaskit-wasm'

import type { SceneGraph } from '@lawha/scene-graph'

import { getCanvasKit } from '#core/canvaskit'
import { exportPDFDocument } from '#core/io/formats/pdf/document'
import type { PDFPageSpec } from '#core/io/formats/pdf/plan'
import { createCanvasKitRasterCodec } from '#core/io/formats/raster'
import { extractExportGraph } from '#core/io/subgraph'

import {
  DIELINE_SPOTS,
  PDF_OUTPUT_INTENTS,
  REGISTRATION_SPOT,
  type PDFOutputIntentId,
  type PDFSpotColor
} from './color'
import { convertToPrintPDF, type PDFXStandard, type PrintConversionResult } from './convert'
import { latin1 } from './file'
import { flattenTransparency } from './flatten'
import { loadPressProfile, type ICCRenderingIntent } from './icc'
import { printIssue, type PrintIssue } from './issues'
import { composePrintSheet, markMargin, pageArtworkBleed } from './sheet'

export {
  DIELINE_SPOTS,
  PDF_OUTPUT_INTENTS,
  rgbToCMYK,
  type CMYK,
  type PDFOutputIntentId,
  type PDFSpotColor
} from './color'
export type { PDFXStandard } from './convert'
export { parseICCProfile, createProfileTransform, type ICCRenderingIntent } from './icc'
export { PRINT_ISSUE_CODES, PRINT_NOTE_CODES, type PrintIssue, type PrintIssueCode } from './issues'
export { artworkBleed, BLEED_GUIDE_NAME } from './sheet'

/** 3 mm, the bleed most printers ask for. */
export const DEFAULT_PRINT_BLEED = (3 / 25.4) * 72

export interface PDFPrintOptions {
  /** Points of artwork past the trim on every side; default 3 mm. A template keeps its own. */
  bleed?: number
  /** Crop marks at the trim's corners, in registration colour; default on. */
  cropMarks?: boolean
  /** The press condition; default FOGRA39 (ISO coated, Europe), whose profile Lawha carries. */
  outputIntent?: PDFOutputIntentId
  /** The condition's ICC profile, to convert colours with and embed in the output intent. */
  outputProfile?: Uint8Array
  /** How colours outside the press gamut are brought in; perceptual by default. */
  renderingIntent?: ICCRenderingIntent
  /** PDF/X-1a (default) flattens transparency into images; PDF/X-4 keeps it live. */
  standard?: PDFXStandard
  /** Inks printed apart: layers painted in their colour print as that ink. Die-line inks always. */
  spotColors?: readonly PDFSpotColor[]
  title?: string
  /** Renders flattened transparency and decodes JPEG images; loaded when needed without it. */
  canvasKit?: CanvasKit
}

export interface PDFPrintResult extends PrintConversionResult {
  /** What the export changed or could not do as asked, which does not rule PDF/X out. */
  notes: PrintIssue[]
}

function resolveOptions(options: PDFPrintOptions) {
  return {
    layout: { bleed: options.bleed ?? DEFAULT_PRINT_BLEED, cropMarks: options.cropMarks ?? true },
    standard: options.standard ?? 'PDF/X-1a:2003',
    outputIntent: options.outputIntent ?? 'FOGRA39'
  }
}

/** A copy of the pages' layers in which the top layers draw past their box into the bleed. */
function printCopy(graph: SceneGraph, specs: readonly PDFPageSpec[]): SceneGraph {
  const { graph: copy } = extractExportGraph(graph, {
    scope: 'selection',
    nodeIds: specs.flatMap((spec) => spec.nodeIds)
  })
  for (const id of specs.flatMap((spec) => spec.nodeIds)) {
    if (copy.getNode(id)?.clipsContent) copy.updateNode(id, { clipsContent: false })
  }
  return copy
}

function profileNote(
  reason: 'unreadable' | 'not-cmyk' | 'none-bundled',
  intent: PDFOutputIntentId
): PrintIssue {
  return reason === 'none-bundled'
    ? printIssue('no-press-profile', PDF_OUTPUT_INTENTS[intent].info)
    : printIssue('profile-unreadable')
}

/**
 * A press-ready PDF of the pages: one page per spec on a sheet with bleed and crop marks, fonts
 * embedded, every colour in CMYK through the press condition's ICC profile or a spot ink,
 * transparency flattened for PDF/X-1a, trim and bleed boxes set, and the press condition with
 * its profile as the output intent. Null when nothing is visible.
 */
export async function exportPrintPDF(
  graph: SceneGraph,
  specs: readonly PDFPageSpec[],
  options: PDFPrintOptions = {}
): Promise<PDFPrintResult | null> {
  const { layout, standard, outputIntent } = resolveOptions(options)
  const notes: PrintIssue[] = []
  const copy = printCopy(graph, specs)
  // A template drawn with its bleed keeps it; others get the bleed asked for.
  const inner = specs.map((spec) => pageArtworkBleed(copy, spec.nodeIds))
  if (inner.some((bleed) => bleed !== null)) notes.push(printIssue('bleed-in-artwork'))
  const pageBleed = inner.map((bleed) => bleed ?? layout.bleed)

  let ck = options.canvasKit ?? null
  const canvasKit = async () => (ck ??= await getCanvasKit())
  if (standard === 'PDF/X-1a:2003') {
    const flattened = await flattenTransparency(copy, specs, {
      canvasKit,
      outset: (index) => (inner[index] === null ? layout.bleed : 0)
    })
    if (flattened > 0) notes.push(printIssue('transparency-flattened', String(flattened)))
  }

  const pdf = await exportPDFDocument(copy, specs, {
    embedFonts: true,
    title: options.title,
    print: { compress: false, composePage: composePrintSheet(copy, layout) }
  })
  if (!pdf) return null
  // JPEG images are decoded to convert them, through CanvasKit, loaded only when one is there.
  const hasJPEG = latin1(pdf.data).includes('/DCTDecode')
  const codec = hasJPEG ? createCanvasKitRasterCodec(await canvasKit()) : null

  const loaded = await loadPressProfile(
    outputIntent,
    options.outputProfile,
    options.renderingIntent
  )
  if (!loaded.profile) notes.push(profileNote(loaded.reason, outputIntent))
  const margin = markMargin(layout)
  const result = convertToPrintPDF(pdf.data, {
    spots: [
      REGISTRATION_SPOT,
      DIELINE_SPOTS.cut,
      DIELINE_SPOTS.crease,
      ...(options.spotColors ?? [])
    ],
    outputIntent,
    outputProfile: loaded.profile?.bytes,
    toCMYK: loaded.profile?.toCMYK,
    standard,
    bleedInset: margin,
    trimInset: pageBleed.map((bleed) => margin + bleed),
    title: options.title,
    decodeImage: codec ? (bytes) => codec.decode(bytes) : undefined
  })
  return { ...result, notes }
}
