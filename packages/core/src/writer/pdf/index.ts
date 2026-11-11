import { numberedFootnotes } from '#core/writer/footnotes'
import { detectDirection, nodeText, type WriterDocument } from '#core/writer/model'
import { writerSections } from '#core/writer/sections'

import { flowBlocks, flowContext, type FlowBlock, type InlineRun } from './flow'
import { FontSet, type WriterFontResolver } from './fonts'
import type { WriterImageConverter } from './images'
import { layoutLines, loadParagraphFaces, type GlyphPiece } from './lines'
import { paginate } from './paginate'
import { renderPDF } from './render'

export type { WriterFontRequest, WriterFontResolver } from './fonts'

/**
 * The document as a PDF made directly, without a browser's print dialog: pages laid out at the
 * doc's page setup with its header, footer and page numbers on every page, Arabic and other
 * complex scripts shaped by HarfBuzz and ordered by the bidirectional algorithm, and the text
 * embedded in its own fonts so it stays selectable and searchable.
 */

export interface WriterPDFOptions {
  /** Gives the font files the text uses; every face the document names is asked for. */
  fonts: WriterFontResolver
  /** Families for characters a run's own font lacks, in order; Arabic first, then Latin. */
  fallbackFamilies?: readonly string[]
  author?: string
  /** Turns WebP, GIF and other images PDF cannot hold into PNG; see `canvasKitImageConverter`. */
  convertImage?: WriterImageConverter
}

export const DEFAULT_FALLBACK_FAMILIES = ['Noto Naskh Arabic', 'Inter'] as const

function runsOf(blocks: readonly FlowBlock[]): InlineRun[] {
  return blocks.flatMap((block) => {
    if (block.kind === 'paragraph') return block.runs
    if (block.kind === 'table')
      return block.rows.flatMap((row) => row.flatMap((cell) => runsOf(cell.blocks)))
    return []
  })
}

/** The regions' text at the size the editor and print show headers and footers in. */
const REGION_SIZE = 9

export async function exportWriterPDF(
  doc: WriterDocument,
  options: WriterPDFOptions
): Promise<Uint8Array> {
  const body = doc.body
  const rtl = detectDirection(nodeText(body)) === 'rtl'
  const context = flowContext(body, doc.defaults)
  const small = {
    ...context,
    defaults: { ...context.defaults, fontSize: REGION_SIZE, fontSizeComplex: REGION_SIZE }
  }
  const blocks = flowBlocks(body.content ?? [], context, rtl, body)
  const regionBlocks = (region: WriterDocument['header']) =>
    flowBlocks(region?.content ?? [], small, rtl).map((block) =>
      block.kind === 'paragraph' ? { ...block, spaceAfter: 0 } : block
    )
  const sections = writerSections(doc).map((section) => ({
    page: section.page,
    header: regionBlocks(section.header),
    footer: regionBlocks(section.footer)
  }))
  const footnotes = numberedFootnotes(doc).flatMap((note) =>
    note.number === null
      ? []
      : [{ number: note.number, blocks: flowBlocks(note.content, small, rtl) }]
  )

  const fonts = new FontSet(options.fonts, options.fallbackFamilies ?? DEFAULT_FALLBACK_FAMILIES)
  const runs = [
    ...runsOf(blocks),
    ...sections.flatMap((section) => [...runsOf(section.header), ...runsOf(section.footer)]),
    ...footnotes.flatMap((note) => runsOf(note.blocks))
  ]
  await loadParagraphFaces(runs, fonts)

  let watermark: GlyphPiece | null = null
  if (doc.watermark?.text) {
    const style = {
      family: context.defaults.fontFamily,
      size: 72,
      bold: true,
      italic: false,
      underline: false,
      strike: false,
      color: '#d9d9d9',
      background: null,
      script: null,
      link: null
    }
    const run: InlineRun = { kind: 'text', text: doc.watermark.text, style }
    await loadParagraphFaces([run], fonts)
    const line = layoutLines(
      {
        kind: 'paragraph',
        runs: [run],
        rtl: detectDirection(doc.watermark.text) === 'rtl',
        align: 'center',
        indent: 0,
        spaceBefore: 0,
        spaceAfter: 0,
        leading: 1,
        marker: null,
        heading: null
      },
      10_000,
      fonts,
      () => ''
    ).at(0)
    const piece = line?.pieces.find((entry) => entry.kind === 'glyphs')
    watermark = piece?.kind === 'glyphs' ? { ...piece, width: line?.width ?? piece.width } : null
  }

  const last = sections.length - 1
  const sectionFor = (section: number) => sections[Math.min(section, last)]
  const input = { blocks, sectionFor, footnotes, watermark, fonts }
  // A first pass finds the page count and each heading's page, which page fields and a table
  // of contents show; the second lays the pages out with them.
  const first = paginate(input)
  const { pages } = paginate({
    ...input,
    headingPages: first.headingPages,
    pageCount: first.pages.length
  })
  return renderPDF(pages, {
    title: doc.title || undefined,
    author: options.author,
    rtl,
    convertImage: options.convertImage
  })
}
