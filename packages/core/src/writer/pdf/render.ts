import {
  PDFArray,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFString,
  type PDFImage,
  type PDFPage
} from '@cantoo/pdf-lib'
import { converter, parse } from 'culori'
import { isValid, toUint8Array } from 'js-base64'

import {
  glyphRunOperators,
  num,
  PDFGlyphFonts,
  type PDFGlyphFont
} from '#core/io/formats/pdf/glyphs'

import type { WriterImageConverter } from './images'
import type { GlyphPiece } from './lines'
import type { DrawOp, LaidOutPage } from './paginate'

/**
 * Writes laid-out pages as PDF: text as real text in embedded fonts (each face a Type 0 font
 * with Identity-H encoding over its TrueType or CFF file, glyphs placed where HarfBuzz shaped
 * them, and a ToUnicode map so the text copies and searches as written), images as image
 * XObjects, rules and fills as paths, and links as link annotations.
 */

const toRGB = converter('rgb')

function rgb(color: string): [number, number, number] {
  const parsed = parse(color)
  const value = parsed ? toRGB(parsed) : null
  return value ? [value.r, value.g, value.b] : [0, 0, 0]
}

/** A piece's glyphs, its left edge at `x` on the baseline at `y`, in its colour. */
function glyphOperators(
  piece: GlyphPiece,
  font: PDFGlyphFont,
  x: number,
  y: number,
  spaceExtra: number
): string {
  return glyphRunOperators(piece, font, { x, y, color: rgb(piece.style.color), spaceExtra })
}

class PageWriter {
  readonly content: string[] = []
  private readonly images = new Map<string, string>()
  readonly fontsUsed = new Set<PDFGlyphFont>()
  readonly links: Array<{ rect: [number, number, number, number]; href: string }> = []

  constructor(
    readonly page: PDFPage,
    readonly height: number,
    private readonly fonts: PDFGlyphFonts,
    private readonly embedImage: (src: string) => Promise<PDFImage | null>
  ) {}

  async draw(op: DrawOp) {
    const h = this.height
    switch (op.kind) {
      case 'rect': {
        const [r, g, b] = rgb(op.color)
        this.content.push(
          `${num(r)} ${num(g)} ${num(b)} rg ${num(op.x)} ${num(h - op.y - op.height)} ${num(op.width)} ${num(op.height)} re f`
        )
        break
      }
      case 'glyphs': {
        const font = this.fonts.use(op.piece.face)
        this.fontsUsed.add(font)
        this.content.push(glyphOperators(op.piece, font, op.x, h - op.baseline, op.spaceExtra))
        break
      }
      case 'watermark': {
        const font = this.fonts.use(op.piece.face)
        this.fontsUsed.add(font)
        const angle = Math.PI / 4
        const cos = Math.cos(angle)
        const sin = Math.sin(angle)
        const piece = { ...op.piece, style: { ...op.piece.style, color: '#d9d9d9' } }
        this.content.push(
          `q ${num(cos)} ${num(sin)} ${num(-sin)} ${num(cos)} ${num(op.cx)} ${num(h - op.cy)} cm`,
          glyphOperators(piece, font, -op.piece.width / 2, -op.piece.size / 3, 0),
          'Q'
        )
        break
      }
      case 'image': {
        const name = await this.image(op.src)
        if (!name) break
        this.content.push(
          `q ${num(op.width)} 0 0 ${num(op.height)} ${num(op.x)} ${num(h - op.y - op.height)} cm /${name} Do Q`
        )
        break
      }
      case 'link':
        this.links.push({
          rect: [op.x, h - op.y - op.height, op.x + op.width, h - op.y],
          href: op.href
        })
        break
    }
  }

  private async image(src: string): Promise<string | null> {
    const known = this.images.get(src)
    if (known) return known
    const image = await this.embedImage(src)
    if (!image) return null
    const name = `Im${this.images.size + 1}`
    this.images.set(src, name)
    this.page.node.setXObject(PDFName.of(name), image.ref)
    return name
  }

  finish(pdf: PDFDocument) {
    const stream = pdf.context.flateStream(new TextEncoder().encode(this.content.join('\n')))
    this.page.node.addContentStream(pdf.context.register(stream))
    if (!this.links.length) return
    const annots = PDFArray.withContext(pdf.context)
    for (const link of this.links) {
      const annotation = pdf.context.obj({
        Type: 'Annot',
        Subtype: 'Link',
        Rect: link.rect.map((value) => PDFNumber.of(Math.round(value * 100) / 100)),
        Border: [0, 0, 0],
        A: { S: 'URI', URI: PDFString.of(link.href) }
      })
      annots.push(pdf.context.register(annotation))
    }
    this.page.node.set(PDFName.of('Annots'), annots)
  }
}

const DATA_URL = /^data:image\/([\w.+-]+);base64,(.*)$/s

export interface RenderOptions {
  title?: string
  author?: string
  /** Right-to-left documents open on their right edge in readers that honour it. */
  rtl?: boolean
  /** Turns an image PDF cannot hold into PNG; without one such images are left out. */
  convertImage?: WriterImageConverter
}

async function embedDataURL(
  pdf: PDFDocument,
  src: string,
  convert: WriterImageConverter | undefined
): Promise<PDFImage | null> {
  const match = DATA_URL.exec(src)
  const data = match?.[2] ?? ''
  if (!match || !isValid(data)) return null
  const bytes = toUint8Array(data)
  const type = match.at(1)?.toLowerCase() ?? ''
  if (type === 'png') return pdf.embedPng(bytes)
  if (type === 'jpeg' || type === 'jpg') return pdf.embedJpg(bytes)
  const png = await convert?.(bytes, `image/${type}`)
  return png ? pdf.embedPng(png) : null
}

export async function renderPDF(pages: readonly LaidOutPage[], options: RenderOptions = {}) {
  const pdf = await PDFDocument.create({ updateMetadata: false })
  const fonts = new PDFGlyphFonts()
  const images = new Map<string, Promise<PDFImage | null>>()
  const embedImage = (src: string) => {
    let pending = images.get(src)
    if (!pending) {
      pending = embedDataURL(pdf, src, options.convertImage).catch(() => null)
      images.set(src, pending)
    }
    return pending
  }
  const writers: PageWriter[] = []
  for (const laid of pages) {
    const page = pdf.addPage([laid.width, laid.height])
    const writer = new PageWriter(page, laid.height, fonts, embedImage)
    for (const op of laid.ops) await writer.draw(op)
    writer.finish(pdf)
    writers.push(writer)
  }
  const refs = await fonts.write(pdf)
  for (const writer of writers) {
    for (const font of writer.fontsUsed) {
      const ref = refs.get(font.name)
      if (ref) writer.page.node.setFontDictionary(PDFName.of(font.name), ref)
    }
  }
  if (options.title) pdf.setTitle(options.title, { showInWindowTitleBar: true })
  if (options.author) pdf.setAuthor(options.author)
  pdf.setProducer('Lawha')
  pdf.setCreator('Lawha')
  if (options.rtl) {
    pdf.catalog.set(PDFName.of('ViewerPreferences'), pdf.context.obj({ Direction: 'R2L' }))
  }
  return pdf.save()
}
