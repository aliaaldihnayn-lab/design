import {
  PDFArray,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFString,
  type PDFImage,
  type PDFPage,
  type PDFRef
} from '@cantoo/pdf-lib'
import { converter, parse } from 'culori'
import { uniq } from 'es-toolkit'
import { isValid, toUint8Array } from 'js-base64'

import type { Face } from './fonts'
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

const num = (value: number) => {
  const rounded = Math.round(value * 1000) / 1000
  return Object.is(rounded, -0) ? '0' : String(rounded)
}

const hex4 = (value: number) => value.toString(16).padStart(4, '0').toUpperCase()

function utf16Hex(text: string): string {
  let out = ''
  for (let i = 0; i < text.length; i += 1) out += hex4(text.charCodeAt(i))
  return out
}

interface EmbeddedFace {
  name: string
  ref: PDFRef
  face: Face
  glyphs: Map<number, { text: string; width: number }>
}

const SKEW = 0.21

function postScriptName(face: Face, index: number): string {
  const family = face.family.replace(/[^A-Za-z0-9]/g, '') || 'Font'
  const style = `${face.bold ? 'Bold' : ''}${face.italic ? 'Italic' : ''}` || 'Regular'
  return `${family}-${style}-${index}`
}

class Fonts {
  private readonly embedded = new Map<string, EmbeddedFace>()

  constructor(private readonly pdf: PDFDocument) {}

  use(face: Face): EmbeddedFace {
    let entry = this.embedded.get(face.key)
    if (!entry) {
      const index = this.embedded.size + 1
      entry = {
        name: `F${index}`,
        ref: this.pdf.context.nextRef(),
        face,
        glyphs: new Map()
      }
      this.embedded.set(face.key, entry)
    }
    return entry
  }

  /** Writes every face used, with the widths and text of the glyphs drawn. */
  finish() {
    let index = 0
    for (const entry of this.embedded.values()) {
      index += 1
      this.write(entry, postScriptName(entry.face, index))
    }
  }

  private write(entry: EmbeddedFace, baseFont: string) {
    const { context } = this.pdf
    const { face } = entry
    const bytes = new Uint8Array(face.bytes)
    const scale = 1000 / face.upem
    const file = context.register(
      context.flateStream(
        bytes,
        face.trueType ? { Length1: bytes.length } : { Subtype: 'OpenType' }
      )
    )
    const [xMin, yMin, xMax, yMax] = face.bbox
    const descriptor = context.register(
      context.obj({
        Type: 'FontDescriptor',
        FontName: baseFont,
        Flags: 4,
        FontBBox: [xMin * scale, yMin * scale, xMax * scale, yMax * scale].map(Math.round),
        ItalicAngle: face.italic && !face.syntheticItalic ? -12 : 0,
        Ascent: Math.round(face.ascender * scale),
        Descent: Math.round(face.descender * scale),
        CapHeight: Math.round(face.ascender * scale * 0.7),
        StemV: face.bold ? 120 : 80,
        [face.trueType ? 'FontFile2' : 'FontFile3']: file
      })
    )
    const widths: Array<number | number[]> = []
    for (const [glyph, info] of [...entry.glyphs].sort(([a], [b]) => a - b)) {
      widths.push(glyph, [Math.round(info.width)])
    }
    const cidFont = context.register(
      context.obj({
        Type: 'Font',
        Subtype: face.trueType ? 'CIDFontType2' : 'CIDFontType0',
        BaseFont: baseFont,
        CIDSystemInfo: {
          Registry: PDFString.of('Adobe'),
          Ordering: PDFString.of('Identity'),
          Supplement: 0
        },
        FontDescriptor: descriptor,
        DW: 1000,
        W: widths,
        ...(face.trueType ? { CIDToGIDMap: 'Identity' } : {})
      })
    )
    const toUnicode = context.register(
      context.flateStream(new TextEncoder().encode(toUnicodeCMap(entry.glyphs)))
    )
    context.assign(
      entry.ref,
      context.obj({
        Type: 'Font',
        Subtype: 'Type0',
        BaseFont: baseFont,
        Encoding: 'Identity-H',
        DescendantFonts: [cidFont],
        ToUnicode: toUnicode
      })
    )
  }
}

function toUnicodeCMap(glyphs: Map<number, { text: string }>): string {
  // A glyph after the first of its cluster (a dot or mark the font draws apart) stands for no
  // text of its own, which an empty destination says, so readers do not invent characters.
  const entries = [...glyphs]
  const blocks: string[] = []
  for (let i = 0; i < entries.length; i += 100) {
    const chunk = entries.slice(i, i + 100)
    blocks.push(
      `${chunk.length} beginbfchar\n${chunk
        .map(([glyph, info]) => `<${hex4(glyph)}> <${utf16Hex(info.text)}>`)
        .join('\n')}\nendbfchar`
    )
  }
  return [
    '/CIDInit /ProcSet findresource begin',
    '12 dict begin',
    'begincmap',
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
    '/CMapName /Adobe-Identity-UCS def',
    '/CMapType 2 def',
    '1 begincodespacerange',
    '<0000> <FFFF>',
    'endcodespacerange',
    ...blocks,
    'endcmap',
    'CMapName currentdict /CMap defineresource pop',
    'end',
    'end'
  ].join('\n')
}

/**
 * The text each glyph stands for: its cluster's characters, on the cluster's widest glyph, the
 * base letter rather than a dot or mark the font draws as a glyph of its own.
 */
function glyphTexts(piece: GlyphPiece): string[] {
  const starts = uniq(piece.glyphs.map((glyph) => glyph.cluster)).sort((a, b) => a - b)
  const base = new Map<number, number>()
  piece.glyphs.forEach((glyph, index) => {
    const current = base.get(glyph.cluster)
    const widest = current === undefined ? null : piece.glyphs[current]
    if (!widest || glyph.advance > widest.advance) base.set(glyph.cluster, index)
  })
  return piece.glyphs.map((glyph, index) => {
    if (base.get(glyph.cluster) !== index) return ''
    const next = starts.find((start) => start > glyph.cluster) ?? piece.text.length
    return piece.text.slice(glyph.cluster, next)
  })
}

/**
 * Content stream operators showing a piece's glyphs, its left edge at `x`: one `TJ` run per
 * baseline, each glyph moved from where its font's own advance would put it to where HarfBuzz
 * placed it, so a reader extracts the piece's text whole.
 */
function glyphOperators(
  piece: GlyphPiece,
  font: EmbeddedFace,
  x: number,
  y: number,
  spaceExtra: number
): string {
  const [r, g, b] = rgb(piece.style.color)
  const texts = glyphTexts(piece)
  const skew = piece.face.syntheticItalic ? SKEW : 0
  const { size } = piece
  // The piece's text as written, for readers that copy text through ActualText rather than
  // glyph by glyph, which a font that draws one glyph for several letters cannot map.
  const parts = [
    `/Span << /ActualText <FEFF${utf16Hex(piece.text)}> >> BDC q`,
    `BT /${font.name} ${num(size)} Tf ${num(r)} ${num(g)} ${num(b)} rg`
  ]
  if (piece.face.syntheticBold) {
    parts.push(`2 Tr ${num(size * 0.03)} w ${num(r)} ${num(g)} ${num(b)} RG`)
  }
  parts.push(`1 0 ${num(skew)} 1 ${num(x)} ${num(y)} Tm`)
  const toUnits = (points: number) => num((-points * 1000) / size)
  let run: string[] = []
  let rise = 0
  const flush = () => {
    if (run.length) parts.push(`[${run.join(' ')}] TJ`)
    run = []
  }
  piece.glyphs.forEach((glyph, index) => {
    const text = texts[index] ?? ''
    const own = (piece.face.font.font.glyphHAdvance(glyph.glyph) * 1000) / piece.face.upem
    const known = font.glyphs.get(glyph.glyph)
    if (!known || (!known.text && text)) {
      font.glyphs.set(glyph.glyph, { text: text || known?.text || '', width: own })
    }
    if (glyph.offsetY !== rise) {
      flush()
      rise = glyph.offsetY
      parts.push(`${num(rise)} Ts`)
    }
    if (glyph.offsetX) run.push(toUnits(glyph.offsetX))
    run.push(`<${hex4(glyph.glyph)}>`)
    const placed = (own * size) / 1000
    const after =
      glyph.advance - placed - glyph.offsetX + (spaceExtra && text === ' ' ? spaceExtra : 0)
    if (Math.abs(after) > 0.0005) run.push(toUnits(after))
  })
  flush()
  if (rise) parts.push('0 Ts')
  // `q`…`Q` keeps the faked bold's render mode and stroke from the pieces after it.
  parts.push('ET', 'Q EMC')
  return parts.join('\n')
}

class PageWriter {
  readonly content: string[] = []
  private readonly images = new Map<string, string>()
  private readonly fontsUsed = new Set<EmbeddedFace>()
  readonly links: Array<{ rect: [number, number, number, number]; href: string }> = []

  constructor(
    readonly page: PDFPage,
    readonly height: number,
    private readonly fonts: Fonts,
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
    for (const font of this.fontsUsed)
      this.page.node.setFontDictionary(PDFName.of(font.name), font.ref)
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
  const type = match[1]?.toLowerCase() ?? ''
  if (type === 'png') return pdf.embedPng(bytes)
  if (type === 'jpeg' || type === 'jpg') return pdf.embedJpg(bytes)
  const png = await convert?.(bytes, `image/${type}`)
  return png ? pdf.embedPng(png) : null
}

export async function renderPDF(pages: readonly LaidOutPage[], options: RenderOptions = {}) {
  const pdf = await PDFDocument.create({ updateMetadata: false })
  const fonts = new Fonts(pdf)
  const images = new Map<string, Promise<PDFImage | null>>()
  const embedImage = (src: string) => {
    let pending = images.get(src)
    if (!pending) {
      pending = embedDataURL(pdf, src, options.convertImage).catch(() => null)
      images.set(src, pending)
    }
    return pending
  }
  for (const laid of pages) {
    const page = pdf.addPage([laid.width, laid.height])
    const writer = new PageWriter(page, laid.height, fonts, embedImage)
    for (const op of laid.ops) await writer.draw(op)
    writer.finish(pdf)
  }
  fonts.finish()
  if (options.title) pdf.setTitle(options.title, { showInWindowTitleBar: true })
  if (options.author) pdf.setAuthor(options.author)
  pdf.setProducer('Lawha')
  pdf.setCreator('Lawha')
  if (options.rtl) {
    pdf.catalog.set(PDFName.of('ViewerPreferences'), pdf.context.obj({ Direction: 'R2L' }))
  }
  return pdf.save()
}
