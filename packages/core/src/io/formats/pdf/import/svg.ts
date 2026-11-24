import type { PDFPageProxy } from 'pdfjs-dist/types/src/display/api'

import { fontInfo } from './font-name'
import {
  buildPath,
  cmyk,
  colourArgs,
  gray,
  invert,
  LINE_CAPS,
  LINE_JOINS,
  rgb,
  type BuiltPath,
  type PDFOps
} from './paths'
import { shadingPaint, type ShadingPaint } from './shading'
import {
  escapeXML,
  matrixAttr,
  multiply,
  n,
  TextCollector,
  type Matrix,
  type PDFFontInfo
} from './text'

/** pdf.js's optional content configuration: which layers show, and their names. */
export interface PDFOptionalContent {
  isVisible(group: unknown): boolean
  getGroup(id: string): { name: string | null } | null
}

interface Clip {
  id: string
  d: string
  transform: Matrix
  evenOdd: boolean
}

/** A fill or stroke: a colour, or a gradient from a shading pattern. */
type Paint = { colour: string } | { shading: ShadingPaint }

interface GraphicsState {
  transform: Matrix
  fill: Paint
  stroke: Paint
  fillAlpha: number
  strokeAlpha: number
  lineWidth: number
  lineCap: string
  lineJoin: string
  miterLimit: number
  dash: number[]
  dashOffset: number
  clips: Clip[]
  font: PDFFontInfo | null
  fontSize: number
  charSpacing: number
  wordSpacing: number
  hScale: number
  leading: number
  rise: number
  textMode: number
}

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]

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
  /** Which optional content (layers) shows, and the layers' names. */
  optionalContent?: PDFOptionalContent | null
}

/** One drawn element and the containers it is drawn in, outermost first. */
interface Drawn {
  markup: string
  chain: readonly string[]
}

type MarkedContent = { layer: string } | null

/** Whether a layer shows; one pdf.js cannot judge shows, as viewers draw it. */
function isLayerVisible(config: PDFOptionalContent, data: object): boolean {
  try {
    return config.isVisible(data)
  } catch {
    return true
  }
}

/** Walks one page's operators, keeping the graphics state and writing SVG elements. */
class PageWalker {
  state: GraphicsState
  readonly stack: GraphicsState[] = []
  readonly out: Drawn[] = []
  readonly defs: string[] = []
  /** Each container's attributes by its key: a layer's name and visibility, or a clip. */
  readonly containers = new Map<string, string>()
  private readonly marked: MarkedContent[] = []
  private readonly text: TextCollector
  private textMatrix: Matrix = IDENTITY
  private lineMatrix: Matrix = IDENTITY
  private ids = 0
  private pendingPath: BuiltPath | null = null
  private pendingClip: 'nonzero' | 'evenodd' | null = null
  private readonly fonts = new Map<string, PDFFontInfo>()
  private readonly handlers = new Map<number, (args: unknown[]) => void | Promise<void>>()

  constructor(
    private readonly options: PageToSVGOptions,
    private readonly page: PDFPageProxy,
    private readonly pageTransform: Matrix,
    private readonly size: { width: number; height: number }
  ) {
    this.state = {
      transform: pageTransform,
      fill: { colour: '#000000' },
      stroke: { colour: '#000000' },
      fillAlpha: 1,
      strokeAlpha: 1,
      lineWidth: 1,
      lineCap: 'butt',
      lineJoin: 'miter',
      miterLimit: 10,
      dash: [],
      dashOffset: 0,
      clips: [],
      font: null,
      fontSize: 0,
      charSpacing: 0,
      wordSpacing: 0,
      hScale: 1,
      leading: 0,
      rise: 0,
      textMode: 0
    }
    this.text = new TextCollector((markup, chain) => this.out.push({ markup, chain }))
    this.registerState()
    this.registerColours()
    this.registerPaths()
    this.registerImages()
    this.registerText()
    this.registerContent()
  }

  async run(fnArray: number[], argsArray: unknown[]): Promise<void> {
    for (const [i, fn] of fnArray.entries()) {
      const handler = this.handlers.get(fn)
      if (handler) await handler((argsArray[i] ?? []) as unknown[])
    }
    this.text.flush()
  }

  private on(op: number | undefined, handler: (args: unknown[]) => void | Promise<void>) {
    if (op !== undefined) this.handlers.set(op, handler)
  }

  private set(patch: Partial<GraphicsState>) {
    this.state = { ...this.state, ...patch }
  }

  private nextId(prefix: string): string {
    return `${prefix}${this.ids++}`
  }

  /** Layers, then clips: the containers what is drawn now sits in. */
  private chain(clips = this.state.clips): string[] {
    const layers = this.marked.flatMap((entry) => (entry ? [entry.layer] : []))
    return [...layers, ...clips.map((clip) => clip.id)]
  }

  /** Adds an element over everything drawn so far, text included. */
  private draw(markup: string, clips = this.state.clips) {
    this.text.flush()
    this.out.push({ markup, chain: this.chain(clips) })
  }

  private save() {
    this.stack.push({ ...this.state, dash: [...this.state.dash] })
  }

  private restore() {
    this.state = this.stack.pop() ?? this.state
  }

  private registerState() {
    const { ops } = this.options
    this.on(ops.save, () => this.save())
    this.on(ops.restore, () => this.restore())
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
        else if (key === 'Font' && Array.isArray(value)) this.setFont(value[0], value[1])
      }
    })
  }

  private registerColours() {
    const { ops } = this.options
    const colour = (value: string): Paint => ({ colour: value })
    this.on(ops.setFillRGBColor, (a) => this.set({ fill: colour(rgb(colourArgs(a))) }))
    this.on(ops.setStrokeRGBColor, (a) => this.set({ stroke: colour(rgb(colourArgs(a))) }))
    this.on(ops.setFillGray, (a) => this.set({ fill: colour(gray(a[0] as number)) }))
    this.on(ops.setStrokeGray, (a) => this.set({ stroke: colour(gray(a[0] as number)) }))
    this.on(ops.setFillCMYKColor, (a) =>
      this.set({ fill: colour(cmyk(...(a as [number, number, number, number]))) })
    )
    this.on(ops.setStrokeCMYKColor, (a) =>
      this.set({ stroke: colour(cmyk(...(a as [number, number, number, number]))) })
    )
    this.on(ops.setFillColorN, (a) => this.set({ fill: this.pattern(a) }))
    this.on(ops.setStrokeColorN, (a) => this.set({ stroke: this.pattern(a) }))
  }

  /**
   * A pattern paint: a shading as a gradient in the page's default space, or, for a tiling
   * pattern, which layers cannot hold, nothing rather than the colour set before it.
   */
  private pattern(args: unknown[]): Paint {
    if (args[0] !== 'Shading' || typeof args[1] !== 'string') return { colour: 'none' }
    const matrix = Array.isArray(args[2]) ? (args[2] as Matrix) : IDENTITY
    const paint = shadingPaint(this.object(args[1]), multiply(this.pageTransform, matrix))
    return paint ? { shading: paint } : { colour: 'none' }
  }

  private object(name: string): unknown {
    const store = name.startsWith('g_') ? this.page.commonObjs : this.page.objs
    return store.has(name) ? store.get(name) : null
  }

  /** SVG paint for `paint` on an element drawn at `transform`, adding a gradient when needed. */
  private paintAttr(paint: Paint, transform: Matrix): { value: string; alpha: number } {
    if ('colour' in paint) return { value: paint.colour, alpha: 1 }
    const id = this.nextId('grad')
    const toElement = invert(transform)
    const gradientTransform = toElement ? multiply(toElement, paint.shading.transform) : IDENTITY
    this.defs.push(paint.shading.markup(id, matrixAttr(gradientTransform)))
    return { value: `url(#${id})`, alpha: 1 }
  }

  private registerPaths() {
    const { ops } = this.options
    this.on(ops.constructPath, (a) => {
      const built = buildPath(ops, a[0] as ArrayLike<number>, a[1] as ArrayLike<number>)
      this.pendingPath = this.pendingPath ? { d: this.pendingPath.d + built.d, rect: null } : built
    })
    this.on(ops.clip, () => {
      this.pendingClip = 'nonzero'
    })
    this.on(ops.eoClip, () => {
      this.pendingClip = 'evenodd'
    })
    const close = () => {
      if (this.pendingPath) this.pendingPath = { ...this.pendingPath, d: `${this.pendingPath.d}Z` }
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
    this.on(ops.shadingFill, (a) => {
      if (typeof a[0] === 'string') this.shadingFill(a[0])
    })
  }

  /**
   * `sh`: a shading painted over the clip. Drawn as the innermost clip's own shape filled with
   * the gradient, as Illustrator writes a gradient-filled shape, or the page when nothing clips.
   */
  private shadingFill(name: string) {
    const paint = shadingPaint(this.object(name), this.state.transform)
    if (!paint) return
    const clips = this.state.clips
    const clip = clips.at(-1)
    const d = clip?.d ?? `M0 0h${n(this.size.width)}v${n(this.size.height)}h${n(-this.size.width)}Z`
    const transform = clip?.transform ?? IDENTITY
    const fill = this.paintAttr({ shading: paint }, transform)
    const alpha = this.state.fillAlpha < 1 ? ` fill-opacity="${n(this.state.fillAlpha)}"` : ''
    const rule = clip?.evenOdd ? ' fill-rule="evenodd"' : ''
    this.draw(
      `<path d="${d}" transform="${matrixAttr(transform)}" fill="${fill.value}"${alpha}${rule}/>`,
      clip ? clips.slice(0, -1) : clips
    )
  }

  private registerImages() {
    const { ops } = this.options
    const draw = async (a: unknown[]) => {
      const name = typeof a[0] === 'string' ? a[0] : null
      const image = name ? await this.options.image(name) : null
      if (!image) return
      // Images draw into the unit square, upside down in PDF space.
      const m = multiply(this.state.transform, [1, 0, 0, -1, 0, 1])
      const alpha = this.state.fillAlpha < 1 ? ` opacity="${n(this.state.fillAlpha)}"` : ''
      this.draw(
        `<image href="${image.href}" width="1" height="1" preserveAspectRatio="none" transform="${matrixAttr(m)}"${alpha}/>`
      )
    }
    this.on(ops.paintImageXObject, draw)
    this.on(ops.paintInlineImageXObject, draw)
  }

  /** Form XObjects draw in their own matrix, clipped to their bounding box. */
  private registerContent() {
    const { ops } = this.options
    this.on(ops.paintFormXObjectBegin, (a) => {
      this.save()
      if (Array.isArray(a[0]) && a[0].length === 6)
        this.set({ transform: multiply(this.state.transform, a[0] as Matrix) })
      const bbox = a[1]
      if (Array.isArray(bbox) && bbox.length === 4) {
        const [x0, y0, x1, y1] = bbox as number[]
        this.pushClip(
          { d: `M${n(x0)} ${n(y0)}H${n(x1)}V${n(y1)}H${n(x0)}Z`, rect: [x0, y0, x1 - x0, y1 - y0] },
          false
        )
      }
    })
    this.on(ops.paintFormXObjectEnd, () => this.restore())
    this.on(ops.beginMarkedContent, () => {
      this.marked.push(null)
      this.text.beginMarked(null)
    })
    this.on(ops.beginMarkedContentProps, (a) => {
      this.marked.push(a[0] === 'OC' ? this.layer(a[1]) : null)
      this.text.beginMarked(typeof a[2] === 'string' ? a[2] : null)
    })
    this.on(ops.endMarkedContent, () => {
      const entry = this.marked.pop()
      this.text.endMarked()
      if (entry) this.text.flush()
    })
  }

  /** An optional content group as a layer: a group named for it, hidden when it is off. */
  private layer(data: unknown): MarkedContent {
    const config = this.options.optionalContent
    if (!config || typeof data !== 'object' || data === null) return null
    const id = Reflect.get(data, 'id')
    const name = typeof id === 'string' ? config.getGroup(id)?.name : null
    if (!name) return null
    const visible = isLayerVisible(config, data)
    const key = this.nextId('layer')
    this.text.flush()
    this.containers.set(key, ` id="${escapeXML(name)}"${visible ? '' : ' display="none"'}`)
    return { layer: key }
  }

  private registerText() {
    const { ops } = this.options
    this.on(ops.setFont, (a) => this.setFont(a[0], a[1]))
    this.on(ops.setTextRenderingMode, (a) => {
      if (typeof a[0] === 'number') this.set({ textMode: a[0] })
    })
    this.on(ops.setCharSpacing, (a) => this.set({ charSpacing: Number(a[0]) || 0 }))
    this.on(ops.setWordSpacing, (a) => this.set({ wordSpacing: Number(a[0]) || 0 }))
    this.on(ops.setHScale, (a) => this.set({ hScale: (Number(a[0]) || 100) / 100 }))
    this.on(ops.setLeading, (a) => this.set({ leading: Number(a[0]) || 0 }))
    this.on(ops.setTextRise, (a) => this.set({ rise: Number(a[0]) || 0 }))
    this.on(ops.beginText, () => {
      this.textMatrix = IDENTITY
      this.lineMatrix = IDENTITY
    })
    this.on(ops.setTextMatrix, (a) => {
      const m = (Array.isArray(a[0]) ? a[0] : a) as Matrix
      this.textMatrix = [...m] as Matrix
      this.lineMatrix = [...m] as Matrix
    })
    const moveText = (x: number, y: number) => {
      this.lineMatrix = multiply(this.lineMatrix, [1, 0, 0, 1, x, y])
      this.textMatrix = this.lineMatrix
    }
    this.on(ops.moveText, (a) => moveText(Number(a[0]) || 0, Number(a[1]) || 0))
    this.on(ops.setLeadingMoveText, (a) => {
      this.set({ leading: -(Number(a[1]) || 0) })
      moveText(Number(a[0]) || 0, Number(a[1]) || 0)
    })
    const nextLine = () => moveText(0, -this.state.leading)
    this.on(ops.nextLine, nextLine)
    const show = (glyphs: unknown) => {
      if (Array.isArray(glyphs)) this.showText(glyphs)
    }
    this.on(ops.showText, (a) => show(a[0]))
    this.on(ops.showSpacedText, (a) => show(a[0]))
    this.on(ops.nextLineShowText, (a) => {
      nextLine()
      show(a[0])
    })
    this.on(ops.nextLineSetSpacingShowText, (a) => {
      this.set({ wordSpacing: Number(a[0]) || 0, charSpacing: Number(a[1]) || 0 })
      nextLine()
      show(a[2])
    })
  }

  private setFont(name: unknown, size: unknown) {
    if (typeof size === 'number') this.set({ fontSize: size })
    if (typeof name !== 'string') return
    let font = this.fonts.get(name)
    if (!font) {
      font = fontInfo(this.object(name))
      this.fonts.set(name, font)
    }
    this.set({ font })
  }

  private showText(glyphs: unknown[]) {
    const s = this.state
    if (!s.font || s.fontSize === 0) return
    const advance = this.text.show(glyphs, {
      matrix: multiply(s.transform, this.textMatrix),
      size: s.fontSize,
      hScale: s.hScale,
      charSpacing: s.charSpacing,
      wordSpacing: s.wordSpacing,
      rise: s.rise,
      font: s.font,
      paint: { attrs: this.textPaint(), chain: this.chain() }
    })
    this.textMatrix = multiply(this.textMatrix, [1, 0, 0, 1, advance, 0])
  }

  /** Paint attributes of text: its fill, or its outline for stroked text, with their alpha. */
  private textPaint(): string {
    const s = this.state
    const mode = s.textMode % 4
    if (mode === 3) return ' fill="none"'
    // Text takes a colour; a gradient's first colour stands in for it.
    const colour = (paint: Paint) => ('colour' in paint ? paint.colour : paint.shading.colour)
    const parts: string[] = []
    if (mode === 1) parts.push('fill="none"')
    else {
      parts.push(`fill="${colour(s.fill)}"`)
      if (s.fillAlpha < 1) parts.push(`fill-opacity="${n(s.fillAlpha)}"`)
    }
    if (mode === 1 || mode === 2) {
      parts.push(`stroke="${colour(s.stroke)}"`)
      if (s.strokeAlpha < 1) parts.push(`stroke-opacity="${n(s.strokeAlpha)}"`)
    }
    return ` ${parts.join(' ')}`
  }

  private strokeAttrs(): string[] {
    const s = this.state
    const scale =
      Math.sqrt(Math.abs(s.transform[0] * s.transform[3] - s.transform[1] * s.transform[2])) || 1
    const stroke = this.paintAttr(s.stroke, s.transform)
    const attrs = [
      `stroke="${stroke.value}"`,
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
    const path = this.pendingPath
    if (path) {
      const s = this.state
      const fillPaint = fill ? this.paintAttr(s.fill, s.transform).value : 'none'
      const strokes = stroke && !('colour' in s.stroke && s.stroke.colour === 'none')
      if (fillPaint !== 'none' || strokes) {
        const attrs = [`d="${path.d}"`, `transform="${matrixAttr(s.transform)}"`]
        attrs.push(`fill="${fillPaint}"`)
        if (fillPaint !== 'none' && s.fillAlpha < 1) attrs.push(`fill-opacity="${n(s.fillAlpha)}"`)
        if (fillPaint !== 'none' && evenOdd) attrs.push('fill-rule="evenodd"')
        if (strokes) attrs.push(...this.strokeAttrs())
        this.draw(`<path ${attrs.join(' ')}/>`)
      }
    }
    this.applyPendingClip()
  }

  private applyPendingClip() {
    if (this.pendingClip && this.pendingPath) {
      this.pushClip(this.pendingPath, this.pendingClip === 'evenodd')
    }
    this.pendingClip = null
    this.pendingPath = null
  }

  /**
   * Clips what is drawn next to `path`. A rectangle around the whole page clips nothing the page
   * frame does not, as PDF writers put around every page, so it adds no layer.
   */
  private pushClip(path: BuiltPath, evenOdd: boolean) {
    const t = this.state.transform
    if (path.rect && t[1] === 0 && t[2] === 0) {
      const [x, y, w, h] = path.rect
      const xs = [t[0] * x + t[4], t[0] * (x + w) + t[4]]
      const ys = [t[3] * y + t[5], t[3] * (y + h) + t[5]]
      const slack = 0.5
      if (
        Math.min(...xs) <= slack &&
        Math.min(...ys) <= slack &&
        Math.max(...xs) >= this.size.width - slack &&
        Math.max(...ys) >= this.size.height - slack
      )
        return
    }
    const id = this.nextId('clip')
    const rule = evenOdd ? ' clip-rule="evenodd"' : ''
    this.defs.push(
      `<clipPath id="${id}"><path d="${path.d}" transform="${matrixAttr(t)}"${rule}/></clipPath>`
    )
    this.containers.set(id, ` clip-path="url(#${id})"`)
    this.set({ clips: [...this.state.clips, { id, d: path.d, transform: t, evenOdd }] })
  }

  /** The drawn elements nested in their layers and clips, opening and closing groups as needed. */
  body(): string {
    const parts: string[] = []
    let open: readonly string[] = []
    for (const { markup, chain } of this.out) {
      let common = 0
      while (common < open.length && common < chain.length && open[common] === chain[common])
        common++
      for (let i = open.length; i > common; i--) parts.push('</g>')
      for (const key of chain.slice(common)) parts.push(`<g${this.containers.get(key) ?? ''}>`)
      parts.push(markup)
      open = chain
    }
    for (let i = open.length; i > 0; i--) parts.push('</g>')
    return parts.join('')
  }
}

/**
 * One PDF page as SVG markup, which the SVG importer then turns into editable vector layers,
 * text and images. Walks pdf.js's operator list: the graphics state (transform, colours,
 * gradients, line style, clipping), optional content (Illustrator's layers), form XObjects,
 * paths with their fill and stroke, text and images, all in drawing order. PDF puts the origin at
 * the bottom left, so the page flips into SVG's top-left space.
 */
export async function pdfPageToSVG(page: PDFPageProxy, options: PageToSVGOptions): Promise<string> {
  const viewport = page.getViewport({ scale: 1 })
  // PDF space → SVG space for this page: flips y, applies rotation and the crop box.
  const pageTransform = viewport.transform as Matrix
  const list = await page.getOperatorList()
  const walker = new PageWalker(options, page, pageTransform, viewport)
  await walker.run(list.fnArray, list.argsArray)
  const defs = walker.defs.length > 0 ? `<defs>${walker.defs.join('')}</defs>` : ''
  const width = n(viewport.width)
  const height = n(viewport.height)
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `${defs}${walker.body()}</svg>`
  )
}
