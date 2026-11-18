import type { PDFPageProxy, TextItem } from 'pdfjs-dist/types/src/display/api'

import { parsePDFFontName, type PDFFontFace } from './font-name'

/**
 * One PDF page as SVG markup, which the SVG importer then turns into editable vector layers,
 * text and images. Walks pdf.js's operator list: the graphics state (transform, colours, line
 * style, clipping), paths with their fill and stroke, text runs from the page's text content, and
 * images. PDF puts the origin at the bottom left, so the page flips into SVG's top-left space.
 */
export interface PDFOps {
  [name: string]: number
}

type Matrix = [number, number, number, number, number, number]

interface GraphicsState {
  transform: Matrix
  fill: string
  stroke: string
  fillAlpha: number
  strokeAlpha: number
  lineWidth: number
  lineCap: string
  lineJoin: string
  miterLimit: number
  dash: number[]
  dashOffset: number
  clip: string | null
}

const multiply = (a: Matrix, b: Matrix): Matrix => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5]
]

const n = (value: number) => String(Math.round(value * 1000) / 1000)
const matrixAttr = (m: Matrix) => `matrix(${m.map(n).join(' ')})`
const escapeXML = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function rgb(args: ArrayLike<number> | string): string {
  if (typeof args === 'string') return args
  const hex = (value: number) => Math.round(value).toString(16).padStart(2, '0')
  return `#${hex(args[0])}${hex(args[1])}${hex(args[2])}`
}

/** pdf.js passes an RGB colour as its three channels, or a hex string in newer builds. */
function colourArgs(args: unknown[] | ArrayLike<number>): ArrayLike<number> | string {
  const first: unknown = Array.isArray(args) ? args[0] : undefined
  if (typeof first === 'string') return first
  return args as ArrayLike<number>
}

function gray(value: number): string {
  const v = Math.round(value * 255)
  return rgb([v, v, v])
}

/** CMYK to sRGB the naive way PDF viewers use without a colour profile. */
function cmyk(c: number, m: number, y: number, k: number): string {
  return rgb([255 * (1 - c) * (1 - k), 255 * (1 - m) * (1 - k), 255 * (1 - y) * (1 - k)])
}

const LINE_CAPS = ['butt', 'round', 'square']
const LINE_JOINS = ['miter', 'round', 'bevel']

interface PathBuilder {
  d: string[]
}

function buildPath(ops: PDFOps, codes: ArrayLike<number>, args: ArrayLike<number>): string {
  const path: PathBuilder = { d: [] }
  let j = 0
  let x = 0
  let y = 0
  for (const code of Array.from(codes)) {
    if (code === ops.rectangle) {
      const [rx, ry, w, h] = [args[j++], args[j++], args[j++], args[j++]]
      path.d.push(`M${n(rx)} ${n(ry)}h${n(w)}v${n(h)}h${n(-w)}Z`)
      x = rx
      y = ry
    } else if (code === ops.moveTo) {
      x = args[j++]
      y = args[j++]
      path.d.push(`M${n(x)} ${n(y)}`)
    } else if (code === ops.lineTo) {
      x = args[j++]
      y = args[j++]
      path.d.push(`L${n(x)} ${n(y)}`)
    } else if (code === ops.curveTo) {
      const c = [args[j++], args[j++], args[j++], args[j++], args[j++], args[j++]]
      path.d.push(`C${c.map(n).join(' ')}`)
      x = c[4]
      y = c[5]
    } else if (code === ops.curveTo2) {
      // First control point is the current point.
      const c = [args[j++], args[j++], args[j++], args[j++]]
      path.d.push(`C${n(x)} ${n(y)} ${c.map(n).join(' ')}`)
      x = c[2]
      y = c[3]
    } else if (code === ops.curveTo3) {
      // Second control point is the end point.
      const c = [args[j++], args[j++], args[j++], args[j++]]
      path.d.push(`C${n(c[0])} ${n(c[1])} ${n(c[2])} ${n(c[3])} ${n(c[2])} ${n(c[3])}`)
      x = c[2]
      y = c[3]
    } else if (code === ops.closePath) {
      path.d.push('Z')
    }
  }
  return path.d.join('')
}

export interface PDFImage {
  width: number
  height: number
  /** A data: URL of the image as PNG. */
  href: string
}

export interface PageToSVGOptions {
  ops: PDFOps
  /** Encodes a decoded pdf.js image (RGB, RGBA or 1-bit) as a PNG data URL. */
  image(name: string): Promise<PDFImage | null>
}

/** What a text-showing operator painted with: its font, and the colour and alpha of its paint. */
interface TextShow {
  font: string
  text: string
  fill: string
  fillAlpha: number
  stroke: string
  strokeAlpha: number
  /** PDF text rendering mode: 0 fill, 1 stroke, 2 both, 3 invisible, 4–7 the same and clip. */
  mode: number
}

/** The characters of a pdf.js glyph run: glyphs with their `unicode`, and numbers for spacing. */
function glyphText(args: unknown[]): string {
  const run = args.find((arg): arg is unknown[] => Array.isArray(arg)) ?? []
  let text = ''
  for (const glyph of run) {
    if (typeof glyph === 'object' && glyph !== null && 'unicode' in glyph) {
      const unicode: unknown = glyph.unicode
      if (typeof unicode === 'string') text += unicode
    }
  }
  return text
}

const initialState = (transform: Matrix): GraphicsState => ({
  transform,
  fill: '#000000',
  stroke: '#000000',
  fillAlpha: 1,
  strokeAlpha: 1,
  lineWidth: 1,
  lineCap: 'butt',
  lineJoin: 'miter',
  miterLimit: 10,
  dash: [],
  dashOffset: 0,
  clip: null
})

/** Walks one page's operators, keeping the graphics state and writing SVG elements. */
class PageWalker {
  state: GraphicsState
  readonly stack: GraphicsState[] = []
  readonly out: string[] = []
  readonly defs: string[] = []
  /** Every text-showing operator, in content order, to colour and face the text content. */
  readonly shows: TextShow[] = []
  private font = ''
  private textMode = 0
  private clipCount = 0
  private pendingPath: string | null = null
  private pendingClip: 'nonzero' | 'evenodd' | null = null
  private readonly handlers = new Map<number, (args: unknown[]) => void | Promise<void>>()

  constructor(
    private readonly options: PageToSVGOptions,
    transform: Matrix
  ) {
    this.state = initialState(transform)
    this.registerState()
    this.registerColours()
    this.registerPaths()
    this.registerImages()
    this.registerText()
  }

  async run(fnArray: number[], argsArray: unknown[]): Promise<void> {
    for (const [i, fn] of fnArray.entries()) {
      const handler = this.handlers.get(fn)
      if (handler) await handler((argsArray[i] ?? []) as unknown[])
    }
  }

  private on(op: number | undefined, handler: (args: unknown[]) => void | Promise<void>) {
    if (op !== undefined) this.handlers.set(op, handler)
  }

  private set(patch: Partial<GraphicsState>) {
    this.state = { ...this.state, ...patch }
  }

  private registerState() {
    const { ops } = this.options
    this.on(ops.save, () => {
      this.stack.push({ ...this.state, dash: [...this.state.dash] })
    })
    this.on(ops.restore, () => {
      this.state = this.stack.pop() ?? this.state
    })
    this.on(ops.transform, (a) =>
      this.set({ transform: multiply(this.state.transform, a as Matrix) })
    )
    this.on(ops.setLineWidth, (a) => this.set({ lineWidth: a[0] as number }))
    this.on(ops.setLineCap, (a) => this.set({ lineCap: LINE_CAPS[a[0] as number] ?? 'butt' }))
    this.on(ops.setLineJoin, (a) => this.set({ lineJoin: LINE_JOINS[a[0] as number] ?? 'miter' }))
    this.on(ops.setMiterLimit, (a) => this.set({ miterLimit: a[0] as number }))
    this.on(ops.setDash, (a) =>
      this.set({ dash: [...(a[0] as number[])], dashOffset: a[1] as number })
    )
    this.on(ops.setGState, (a) => {
      for (const [key, value] of a[0] as [string, unknown][]) {
        if (key === 'ca') this.set({ fillAlpha: value as number })
        else if (key === 'CA') this.set({ strokeAlpha: value as number })
        else if (key === 'LW') this.set({ lineWidth: value as number })
      }
    })
  }

  private registerColours() {
    const { ops } = this.options
    this.on(ops.setFillRGBColor, (a) => this.set({ fill: rgb(colourArgs(a)) }))
    this.on(ops.setStrokeRGBColor, (a) => this.set({ stroke: rgb(colourArgs(a)) }))
    this.on(ops.setFillGray, (a) => this.set({ fill: gray(a[0] as number) }))
    this.on(ops.setStrokeGray, (a) => this.set({ stroke: gray(a[0] as number) }))
    this.on(ops.setFillCMYKColor, (a) =>
      this.set({ fill: cmyk(...(a as [number, number, number, number])) })
    )
    this.on(ops.setStrokeCMYKColor, (a) =>
      this.set({ stroke: cmyk(...(a as [number, number, number, number])) })
    )
  }

  private registerPaths() {
    const { ops } = this.options
    this.on(ops.constructPath, (a) => {
      const d = buildPath(ops, a[0] as ArrayLike<number>, a[1] as ArrayLike<number>)
      this.pendingPath = (this.pendingPath ?? '') + d
    })
    this.on(ops.clip, () => {
      this.pendingClip = 'nonzero'
    })
    this.on(ops.eoClip, () => {
      this.pendingClip = 'evenodd'
    })
    const close = () => {
      if (this.pendingPath) this.pendingPath += 'Z'
    }
    this.on(ops.fill, () => this.paint(true, false, false))
    this.on(ops.eoFill, () => this.paint(true, false, true))
    this.on(ops.stroke, () => this.paint(false, true, false))
    this.on(ops.fillStroke, () => this.paint(true, true, false))
    this.on(ops.eoFillStroke, () => this.paint(true, true, true))
    this.on(ops.closeStroke, () => {
      close()
      this.paint(false, true, false)
    })
    this.on(ops.closeFillStroke, () => {
      close()
      this.paint(true, true, false)
    })
    this.on(ops.closeEOFillStroke, () => {
      close()
      this.paint(true, true, true)
    })
    this.on(ops.endPath, () => this.applyPendingClip())
  }

  private registerImages() {
    const { ops } = this.options
    const draw = async (a: unknown[]) => {
      const name = typeof a[0] === 'string' ? a[0] : null
      const image = name ? await this.options.image(name) : null
      if (!image) return
      // Images draw into the unit square, upside down in PDF space.
      const m = multiply(this.state.transform, [1, 0, 0, -1, 0, 1])
      this.out.push(
        `<image href="${image.href}" width="1" height="1" preserveAspectRatio="none" transform="${matrixAttr(m)}"${this.clipAttr()}/>`
      )
    }
    this.on(ops.paintImageXObject, draw)
    this.on(ops.paintInlineImageXObject, draw)
  }

  private registerText() {
    const { ops } = this.options
    this.on(ops.setFont, (a) => {
      if (typeof a[0] === 'string') this.font = a[0]
    })
    this.on(ops.setTextRenderingMode, (a) => {
      if (typeof a[0] === 'number') this.textMode = a[0]
    })
    const show = (a: unknown[]) => {
      const s = this.state
      this.shows.push({
        font: this.font,
        text: glyphText(a),
        fill: s.fill,
        fillAlpha: s.fillAlpha,
        stroke: s.stroke,
        strokeAlpha: s.strokeAlpha,
        mode: this.textMode
      })
    }
    for (const op of [
      ops.showText,
      ops.showSpacedText,
      ops.nextLineShowText,
      ops.nextLineSetSpacingShowText
    ])
      this.on(op, show)
  }

  private clipAttr(): string {
    return this.state.clip ? ` clip-path="url(#${this.state.clip})"` : ''
  }

  private strokeAttrs(): string[] {
    const s = this.state
    const scale =
      Math.sqrt(Math.abs(s.transform[0] * s.transform[3] - s.transform[1] * s.transform[2])) || 1
    const attrs = [
      `stroke="${s.stroke}"`,
      `stroke-width="${n(Math.max(s.lineWidth, 0.25 / scale))}"`,
      `stroke-linecap="${s.lineCap}"`,
      `stroke-linejoin="${s.lineJoin}"`,
      `stroke-miterlimit="${n(s.miterLimit)}"`
    ]
    if (s.strokeAlpha < 1) attrs.push(`stroke-opacity="${n(s.strokeAlpha)}"`)
    if (s.dash.length > 0) {
      attrs.push(
        `stroke-dasharray="${s.dash.map(n).join(' ')}"`,
        `stroke-dashoffset="${n(s.dashOffset)}"`
      )
    }
    return attrs
  }

  private paint(fill: boolean, stroke: boolean, evenOdd: boolean) {
    if (this.pendingPath) {
      const s = this.state
      const attrs = [`d="${this.pendingPath}"`, `transform="${matrixAttr(s.transform)}"`]
      attrs.push(fill ? `fill="${s.fill}"` : 'fill="none"')
      if (fill && s.fillAlpha < 1) attrs.push(`fill-opacity="${n(s.fillAlpha)}"`)
      if (fill && evenOdd) attrs.push('fill-rule="evenodd"')
      if (stroke) attrs.push(...this.strokeAttrs())
      this.out.push(`<path ${attrs.join(' ')}${this.clipAttr()}/>`)
    }
    this.applyPendingClip()
  }

  private applyPendingClip() {
    if (this.pendingClip && this.pendingPath) {
      const id = `clip${this.clipCount++}`
      const rule = this.pendingClip === 'evenodd' ? ' clip-rule="evenodd"' : ''
      this.defs.push(
        `<clipPath id="${id}"${this.clipAttr()}><path d="${this.pendingPath}" transform="${matrixAttr(this.state.transform)}"${rule}/></clipPath>`
      )
      this.set({ clip: id })
    }
    this.pendingClip = null
    this.pendingPath = null
  }
}

export async function pdfPageToSVG(page: PDFPageProxy, options: PageToSVGOptions): Promise<string> {
  const viewport = page.getViewport({ scale: 1 })
  // PDF space → SVG space for this page: flips y, applies rotation and the crop box.
  const pageTransform = viewport.transform as Matrix
  const list = await page.getOperatorList()
  const walker = new PageWalker(options, pageTransform)
  await walker.run(list.fnArray, list.argsArray)
  walker.out.push(...(await textElements(page, pageTransform, walker.shows)))
  const defs = walker.defs.length > 0 ? `<defs>${walker.defs.join('')}</defs>` : ''
  const width = n(viewport.width)
  const height = n(viewport.height)
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `${defs}${walker.out.join('')}</svg>`
  )
}

/** The face pdf.js loaded a font as: its PostScript name and style flags, when it has one. */
function loadedFace(page: PDFPageProxy, loadedName: string): PDFFontFace | null {
  if (!loadedName || !page.commonObjs.has(loadedName)) return null
  const font: unknown = page.commonObjs.get(loadedName)
  if (typeof font !== 'object' || font === null || !('name' in font)) return null
  const name: unknown = font.name
  if (typeof name !== 'string' || !name) return null
  const flag = (key: 'bold' | 'black' | 'italic') => key in font && Reflect.get(font, key) === true
  return parsePDFFontName(name, {
    bold: flag('bold'),
    black: flag('black'),
    italic: flag('italic')
  })
}

/**
 * The show that drew each text item: the next one in content order in the item's font, and
 * among those the first whose characters start the item, as pdf.js joins and splits runs.
 */
function matchShows(items: { fontName: string; str: string }[], shows: TextShow[]) {
  let next = 0
  return items.map((item) => {
    const candidates = shows
      .slice(next)
      .map((show, offset) => ({ show, index: next + offset }))
      .filter(({ show }) => show.font === item.fontName)
    const head = item.str.trim().slice(0, 1)
    const found =
      candidates.find(({ show }) => head !== '' && show.text.trim().startsWith(head)) ??
      candidates.at(0)
    if (!found) return null
    next = found.index + 1
    return found.show
  })
}

/** Paint attributes of text: its fill, or its outline for stroked text, with their alpha. */
function textPaint(show: TextShow | null): string {
  if (!show) return ' fill="#000000"'
  const mode = show.mode % 4
  if (mode === 3) return ' fill="none"'
  const parts: string[] = []
  if (mode === 1) parts.push('fill="none"')
  else {
    parts.push(`fill="${show.fill}"`)
    if (show.fillAlpha < 1) parts.push(`fill-opacity="${n(show.fillAlpha)}"`)
  }
  if (mode === 1 || mode === 2) {
    parts.push(`stroke="${show.stroke}"`)
    if (show.strokeAlpha < 1) parts.push(`stroke-opacity="${n(show.strokeAlpha)}"`)
  }
  return ` ${parts.join(' ')}`
}

function faceAttrs(face: PDFFontFace | null, fallback: string): string {
  const family = face ? `${face.family}, ${fallback}` : fallback
  const weight = face && face.weight !== 400 ? ` font-weight="${face.weight}"` : ''
  const italic = face?.italic ? ' font-style="italic"' : ''
  return ` font-family="${escapeXML(family.replace(/"/g, ''))}"${weight}${italic}`
}

/**
 * Live text: each run of the page's text content, at its place, size and direction, in the face
 * its font names and the colour the operator that showed it painted with.
 */
async function textElements(
  page: PDFPageProxy,
  pageTransform: Matrix,
  shows: TextShow[]
): Promise<string[]> {
  const content = await page.getTextContent()
  const items = content.items.filter(
    (item): item is TextItem => 'str' in item && item.str.trim() !== ''
  )
  const matched = matchShows(items, shows)
  const faces = new Map<string, PDFFontFace | null>()
  const out: string[] = []
  for (const [index, item] of items.entries()) {
    const style = content.styles[item.fontName] as { fontFamily?: string } | undefined
    const t = multiply(pageTransform, item.transform as Matrix)
    const size = Math.hypot(t[2], t[3]) || 1
    // Unit-size glyph axes, so the text keeps its rotation without being stretched.
    const m: Matrix = [t[0] / size, t[1] / size, -t[2] / size, -t[3] / size, t[4], t[5]]
    if (!faces.has(item.fontName)) faces.set(item.fontName, loadedFace(page, item.fontName))
    const face = faces.get(item.fontName) ?? null
    const rtl = item.dir === 'rtl'
    out.push(
      `<text transform="${matrixAttr(m)}" font-size="${n(size)}"${faceAttrs(face, style?.fontFamily ?? 'sans-serif')}${rtl ? ' direction="rtl" unicode-bidi="plaintext"' : ''}${textPaint(matched[index] ?? null)}>${escapeXML(item.str)}</text>`
    )
  }
  return out
}
