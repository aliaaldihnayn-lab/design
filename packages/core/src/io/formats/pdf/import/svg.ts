import type { PDFPageProxy } from 'pdfjs-dist/types/src/display/api'

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
  walker.out.push(...(await textElements(page, pageTransform)))
  const defs = walker.defs.length > 0 ? `<defs>${walker.defs.join('')}</defs>` : ''
  const width = n(viewport.width)
  const height = n(viewport.height)
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `${defs}${walker.out.join('')}</svg>`
  )
}

/** Live text: each run of the page's text content, at its place, size and direction. */
async function textElements(page: PDFPageProxy, pageTransform: Matrix): Promise<string[]> {
  const content = await page.getTextContent()
  const out: string[] = []
  for (const item of content.items) {
    if (!('str' in item) || item.str.trim() === '') continue
    const style = content.styles[item.fontName] as { fontFamily?: string } | undefined
    const t = multiply(pageTransform, item.transform as Matrix)
    const size = Math.hypot(t[2], t[3]) || 1
    // Unit-size glyph axes, so the text keeps its rotation without being stretched.
    const m: Matrix = [t[0] / size, t[1] / size, -t[2] / size, -t[3] / size, t[4], t[5]]
    const family = (style?.fontFamily ?? 'sans-serif').replace(/"/g, '')
    const rtl = item.dir === 'rtl'
    out.push(
      `<text transform="${matrixAttr(m)}" font-size="${n(size)}" font-family="${escapeXML(family)}"${rtl ? ' direction="rtl" unicode-bidi="plaintext"' : ''} fill="#000000">${escapeXML(item.str)}</text>`
    )
  }
  return out
}
