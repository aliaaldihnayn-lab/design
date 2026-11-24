import type { SceneGraph } from '@lawha/scene-graph'
import type { Vector } from '@lawha/scene-graph/primitives'

import { computeContentBounds } from '#core/io/formats/raster'
import {
  renderNodesToSVG,
  type SVGExportOptions,
  type SVGImageAdjust,
  type SVGTextLayout
} from '#core/io/formats/svg'

import { withPDFDOM, type SVGPageParser } from './dom'
import {
  cutFontInstances,
  dropUnnamedFaces,
  embeddedFontAlias,
  nameEmbeddedFonts,
  planFontEmbedding,
  registerEmbeddedFonts,
  type PDFFallbackFontFile,
  type PDFFontFace,
  type PDFFontReport
} from './fonts'
import type { PDFGlyphText } from './glyph-text'
import type { PDFPageSpec } from './plan'

export interface PDFExportOptions {
  title?: string
  /** The faces the text uses, to embed their files; without them text uses standard PDF fonts. */
  fonts?: readonly PDFFontFace[]
  /** Line breaks of text nodes as the editor laid them out, so paragraphs stay wrapped. */
  textLayout?: SVGTextLayout
  /** The files of fallback faces the text layout draws characters in, to embed them too. */
  fallbackFile?: PDFFallbackFontFile
  /** Bakes image adjustments into embedded images, so the PDF matches the canvas. */
  imageAdjust?: SVGImageAdjust
  /** Leaves page content uncompressed, for a pass that rewrites it, such as print export. */
  compress?: boolean
  /** Lays a page's drawing out on its sheet, such as with bleed and crop marks around it. */
  composePage?: PDFPageComposer
  /**
   * Draws text as the glyphs the canvas laid out, in fonts embedded by glyph ID; text it cannot
   * draw so falls back to jsPDF's text in the `fonts` it embeds.
   */
  glyphText?: PDFGlyphText
}

/** A page's drawing, sized to its content, and where that content sits on the canvas. */
export interface PDFPageDrawing {
  spec: PDFPageSpec
  svg: string
  width: number
  height: number
  /** The canvas position of the drawing's top left corner. */
  origin: Vector
}

export type PDFPageComposer = (
  page: PDFPageDrawing
) => { svg: string; width: number; height: number } | null

export interface PDFExportResult {
  data: Uint8Array
  /** The pages written, in order. Pages with nothing visible are skipped. */
  pages: Array<{ label?: string; width: number; height: number }>
  /** Embedded and fallback faces, when `fonts` was given. */
  fonts?: PDFFontReport
}

interface PreparedPage {
  spec: PDFPageSpec
  svgElement: Element
  width: number
  height: number
}

type PageSVGOptions = Pick<
  SVGExportOptions,
  'textLayout' | 'fontAlias' | 'imageAdjust' | 'placeTrackedLetters' | 'drawText'
>

function preparePage(
  graph: SceneGraph,
  spec: PDFPageSpec,
  index: number,
  svgOptions: PageSVGOptions,
  parse: SVGPageParser,
  compose?: PDFPageComposer
): PreparedPage | null {
  const svg = renderNodesToSVG(graph, spec.pageId, spec.nodeIds, {
    xmlDeclaration: false,
    ...svgOptions,
    // svg2pdf keeps gradients, patterns and clips by id for the whole document, so a page
    // reusing another page's ids would draw with that page's images and gradients.
    idPrefix: `p${index}-`
  })
  if (!svg) return null

  const bounds = computeContentBounds(graph, spec.nodeIds)
  if (!bounds) return null

  const width = bounds.maxX - bounds.minX
  const height = bounds.maxY - bounds.minY
  if (width <= 0 || height <= 0) return null

  const sheet = compose
    ? compose({ spec, svg, width, height, origin: { x: bounds.minX, y: bounds.minY } })
    : { svg, width, height }
  if (!sheet) return null
  const svgElement = parse(sheet.svg)
  return svgElement ? { spec, svgElement, width: sheet.width, height: sheet.height } : null
}

/** The parts of jsPDF a placeholder for glyphs is written through. */
interface GlyphTextTarget {
  text: (...args: never[]) => unknown
  internal: object
}

/**
 * Has `doc` write the glyphs of each placeholder svg2pdf asks it to write as text, in the state
 * svg2pdf set for it: its clip, opacity and transform, which svg2pdf hands over as `angle`.
 */
function drawGlyphText(doc: GlyphTextTarget, glyphText: PDFGlyphText): void {
  const write = doc.text.bind(doc)
  const out: unknown = Reflect.get(doc.internal, 'write')
  if (typeof out !== 'function') return
  const text = (content: unknown, x: unknown, y: unknown, options?: { angle?: unknown }) => {
    const matrix = jsPDFMatrix(options?.angle)
    const operators =
      typeof content === 'string' && typeof x === 'number' && typeof y === 'number' && matrix
        ? glyphText.operators(content, matrix, x, y)
        : null
    if (operators === null) return Reflect.apply(write, doc, [content, x, y, options])
    Reflect.apply(out, doc.internal, [operators])
    return doc
  }
  Object.defineProperty(doc, 'text', { value: text, configurable: true, writable: true })
}

/** The six numbers of a jsPDF `Matrix`, as SVG's `matrix(a b c d e f)` orders them. */
function jsPDFMatrix(value: unknown): number[] | null {
  if (typeof value !== 'object' || value === null) return [1, 0, 0, 1, 0, 0]
  const numbers = ['sx', 'shy', 'shx', 'sy', 'tx', 'ty'].map((key) => Reflect.get(value, key))
  return numbers.every((entry): entry is number => typeof entry === 'number') ? numbers : null
}

const orientationOf = (page: PreparedPage) => (page.width > page.height ? 'landscape' : 'portrait')

/**
 * A PDF with one page per spec, each sized to its content. Null when no page has anything visible.
 */
export function renderPagesToPDFDetailed(
  graph: SceneGraph,
  specs: readonly PDFPageSpec[],
  options: PDFExportOptions = {}
): Promise<PDFExportResult | null> {
  return withPDFDOM((parse) => renderPages(graph, specs, options, parse))
}

async function renderPages(
  graph: SceneGraph,
  specs: readonly PDFPageSpec[],
  options: PDFExportOptions,
  parse: SVGPageParser
): Promise<PDFExportResult | null> {
  const embedding = options.fonts ? planFontEmbedding(options.fonts, options.fallbackFile) : null
  const svgOptions: PageSVGOptions = {
    textLayout: options.textLayout,
    fontAlias: embedding ? embeddedFontAlias(embedding) : undefined,
    imageAdjust: options.imageAdjust,
    // svg2pdf writes no letter spacing, so tracked letters are each placed where they are drawn.
    placeTrackedLetters: true,
    drawText: options.glyphText?.drawer
  }
  const preparePages = () =>
    specs
      .map((spec, index) => preparePage(graph, spec, index, svgOptions, parse, options.composePage))
      .filter((page): page is PreparedPage => page !== null)
  let prepared = preparePages()
  if (prepared.length === 0) return null
  const first = prepared[0]

  const [{ jsPDF }, { svg2pdf }] = await Promise.all([import('jspdf'), import('svg2pdf.js')])

  const doc = new jsPDF({
    orientation: orientationOf(first),
    unit: 'pt',
    format: [first.width, first.height],
    compress: options.compress ?? true
  })

  if (options.title) {
    doc.setProperties({ title: options.title })
  }
  if (options.glyphText) drawGlyphText(doc, options.glyphText)

  // The pages name the variable instances they draw, which are cut now. jsPDF reads a font file
  // when it is registered, so a face it refuses is only known then. Either way, the pages are
  // written again without the names of faces that are not embedded.
  if (embedding) {
    if (options.glyphText) dropUnnamedFaces(embedding)
    const cut = await cutFontInstances(embedding)
    if (!registerEmbeddedFonts(doc, embedding) || !cut) prepared = preparePages()
  }

  for (const [index, page] of prepared.entries()) {
    if (index > 0) doc.addPage([page.width, page.height], orientationOf(page))
    await svg2pdf(page.svgElement, doc, { x: 0, y: 0, width: page.width, height: page.height })
  }

  if (embedding) nameEmbeddedFonts(doc, embedding)

  const output = new Uint8Array(doc.output('arraybuffer'))
  const data = options.glyphText ? await options.glyphText.embed(output) : output
  if (embedding && options.glyphText) {
    embedding.report.embedded.unshift(...options.glyphText.embeddedFaces())
  }
  return {
    data,
    pages: prepared.map((page) => ({
      label: page.spec.label,
      width: page.width,
      height: page.height
    })),
    ...(embedding ? { fonts: embedding.report } : {})
  }
}
