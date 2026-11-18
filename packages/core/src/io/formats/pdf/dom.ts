import type * as HappyDOM from 'happy-dom'
import { isValid, toUint8Array } from 'js-base64'

import { imageSize } from '@lawha/scene-graph/images'

import { IS_BROWSER } from '#core/constants'

/** A page's SVG markup as the element svg2pdf draws, or null when it does not parse. */
export type SVGPageParser = (svg: string) => Element | null

interface SVGParser {
  parseFromString(
    svg: string,
    type: 'image/svg+xml'
  ): {
    querySelector(selectors: string): unknown
    documentElement: unknown
  }
}

/**
 * The globals svg2pdf reads: it parses a page's stylesheets in a document it makes, and keeps the
 * rules that are instances of the CSSOM classes.
 */
interface SVG2PDFGlobals {
  document?: unknown
  CSSStyleSheet?: unknown
  CSSStyleRule?: unknown
  Image?: unknown
}

const SVG2PDF_GLOBALS = ['document', 'CSSStyleSheet', 'CSSStyleRule', 'Image'] as const

const DATA_URI = /^data:image\/[\w.+-]+;base64,(.*)$/s

/**
 * The `Image` svg2pdf measures an embedded image with: it sets `src` to the image's data URI and
 * reads `width` and `height` once `onload` fires. happy-dom decodes no images, so its header
 * gives the size; anything else fails as an image that cannot load does.
 */
class DataImage {
  width = 0
  height = 0
  onload: (() => void) | null = null
  onerror: ((error: Error) => void) | null = null
  private source = ''

  get src(): string {
    return this.source
  }

  set src(value: string) {
    this.source = value
    const base64 = DATA_URI.exec(value)?.[1]?.replace(/\s/g, '')
    const size = base64 && isValid(base64) ? imageSize(toUint8Array(base64)) : null
    queueMicrotask(() => {
      if (size) {
        this.width = size.width
        this.height = size.height
        this.onload?.()
      } else {
        this.onerror?.(new Error('Unreadable image'))
      }
    })
  }
}

type SVG2PDFGlobal = (typeof SVG2PDF_GLOBALS)[number]

function removeGlobal(scope: SVG2PDFGlobals, name: SVG2PDFGlobal): void {
  if (name === 'document') delete scope.document
  else if (name === 'CSSStyleSheet') delete scope.CSSStyleSheet
  else if (name === 'Image') delete scope.Image
  else delete scope.CSSStyleRule
}

/**
 * Kept out of the browser bundle: a browser has a DOM of its own, and happy-dom is only loaded
 * where there is none.
 */
const HAPPY_DOM = 'happy-dom'

let exporting: Promise<unknown> = Promise.resolve()

function isElement(value: unknown): value is Element {
  return typeof value === 'object' && value !== null && 'tagName' in value
}

function parseSVGPage(parser: SVGParser): SVGPageParser {
  return (svg) => {
    const parsed = parser.parseFromString(svg, 'image/svg+xml')
    if (parsed.querySelector('parsererror')) return null
    return isElement(parsed.documentElement) ? parsed.documentElement : null
  }
}

/**
 * Runs `draw` with a parser for page SVG and the DOM svg2pdf draws it through. A browser has both.
 * Elsewhere, as in the CLI, happy-dom stands in: svg2pdf reads its DOM as globals, so they are set
 * only while `draw` runs, one export at a time, and restored after.
 */
export function withPDFDOM<T>(draw: (parse: SVGPageParser) => Promise<T>): Promise<T> {
  if (IS_BROWSER) return draw(parseSVGPage(new DOMParser()))
  const run = exporting.then(() => withHappyDOM(draw))
  exporting = run.catch(() => undefined)
  return run
}

async function withHappyDOM<T>(draw: (parse: SVGPageParser) => Promise<T>): Promise<T> {
  const { Window } = (await import(/* @vite-ignore */ HAPPY_DOM)) as typeof HappyDOM
  const dom = new Window()
  const scope: SVG2PDFGlobals = globalThis
  const values: Required<SVG2PDFGlobals> = {
    document: dom.document,
    CSSStyleSheet: dom.CSSStyleSheet,
    CSSStyleRule: dom.CSSStyleRule,
    Image: DataImage
  }
  // Each global replaced, with its descriptor before, so an accessor a host defines comes back as
  // one and a global that could not be replaced is left as it was.
  const replaced: Array<[SVG2PDFGlobal, PropertyDescriptor | undefined]> = []
  try {
    for (const name of SVG2PDF_GLOBALS) {
      const previous = Object.getOwnPropertyDescriptor(globalThis, name)
      Object.defineProperty(globalThis, name, {
        value: values[name],
        configurable: true,
        writable: true
      })
      replaced.push([name, previous])
    }
    return await draw(parseSVGPage(new dom.DOMParser()))
  } finally {
    // What is replaced is configurable, so putting it back does not throw.
    for (const [name, previous] of replaced) {
      if (previous) Object.defineProperty(globalThis, name, previous)
      else removeGlobal(scope, name)
    }
    await dom.happyDOM.close()
  }
}
