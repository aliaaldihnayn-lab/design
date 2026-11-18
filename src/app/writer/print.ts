import { escapeText } from 'entities'

import {
  detectDirection,
  nodeText,
  stringAttr,
  twipsToMM,
  type WriterDocument,
  type WriterNode
} from '@lawha/core/writer'

/**
 * The document as a printable page for the browser's print dialog, whose "Save as PDF" gives
 * the PDF: the page size and margins through `@page`, the header and footer in its margin boxes
 * with live page numbers, and the body as the editor's HTML.
 */

const mm = (twips: number) => `${Math.round(twipsToMM(twips) * 100) / 100}mm`

/** A CSS string literal. */
const cssString = (value: string) =>
  `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\A ')}"`

/** Inline content as a `content:` value, page fields as counters. */
function marginContent(paragraph: WriterNode): string {
  const parts: string[] = []
  for (const child of paragraph.content ?? []) {
    if (child.type === 'text' && child.text) parts.push(cssString(child.text))
    else if (child.type === 'pageNumber') parts.push('counter(page)')
    else if (child.type === 'pageCount') parts.push('counter(pages)')
    else if (child.type === 'hardBreak') parts.push('"\\A "')
  }
  return parts.join(' ')
}

type MarginBoxSide = 'left' | 'center' | 'right'

/** Which margin box a paragraph prints in: its alignment, or its start edge. */
function marginSide(paragraph: WriterNode): MarginBoxSide {
  const align = stringAttr(paragraph.attrs, 'textAlign')
  if (align === 'center') return 'center'
  if (align === 'left' || align === 'right') return align
  const dir = stringAttr(paragraph.attrs, 'dir')
  const rtl = dir === 'rtl' || (dir !== 'ltr' && detectDirection(nodeText(paragraph)) === 'rtl')
  return rtl ? 'right' : 'left'
}

/** `@top-left { … }` rules for a header or footer. */
export function marginBoxes(region: WriterNode | null, edge: 'top' | 'bottom'): string {
  if (!region) return ''
  const boxes = new Map<MarginBoxSide, string[]>()
  for (const paragraph of region.content ?? []) {
    const content = marginContent(paragraph)
    if (!content) continue
    const side = marginSide(paragraph)
    boxes.set(side, [...(boxes.get(side) ?? []), content])
  }
  return [...boxes]
    .map(
      ([side, lines]) =>
        `@${edge}-${side} { content: ${lines.join(' "\\A " ')}; white-space: pre; font-size: 9pt; }`
    )
    .join('\n')
}

/** Paper styles for the printed body, matching the editor's paper. */
const PRINT_CONTENT_CSS = `
body { margin: 0; font-family: Calibri, Arial, sans-serif; font-size: 11pt; line-height: 1.4; color: #000; }
p { margin: 0 0 8pt; min-height: 1.4em; }
h1 { font-size: 16pt; margin: 18pt 0 4pt; } h2 { font-size: 13pt; margin: 12pt 0 4pt; }
h3 { font-size: 12pt; margin: 12pt 0 4pt; } h4, h5, h6 { font-size: 11pt; margin: 10pt 0 4pt; }
ul, ol { padding-inline-start: 0.25in; } li p { margin: 0; }
a { color: #0563c1; }
table { border-collapse: collapse; width: 100%; table-layout: fixed; margin: 6pt 0; }
td, th { border: 1px solid #000; padding: 0 5.4pt; vertical-align: top; } td p, th p { margin: 0; }
img { max-width: 100%; }
.writer-page-break { break-after: page; height: 0; }
.writer-page-field { background: none; }
.writer-comment { background: none; border: 0; }
del.writer-deletion { display: none; } ins.writer-insertion { text-decoration: none; }
.writer-form-field { border-bottom: 1px solid #000; padding: 0 2pt; }
body { counter-reset: footnote; }
.writer-footnote { counter-increment: footnote; } .writer-footnote::after { content: counter(footnote); }
.writer-toc > div[data-level="2"] { padding-inline-start: 16pt; } .writer-toc > div[data-level="3"] { padding-inline-start: 32pt; }
.writer-watermark { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: none; z-index: -1; }
.writer-watermark span { transform: rotate(-45deg); font-size: 96pt; font-weight: bold; opacity: 0.15; white-space: nowrap; }
.writer-footnotes { margin-top: 18pt; border-top: 1px solid #000; padding-top: 6pt; font-size: 9pt; }
`

export interface PrintOptions {
  /** The editor's HTML for the body. */
  bodyHTML: string
  /** Footnote texts in order, printed after the body. */
  footnotes?: readonly string[]
  fontsStylesheet?: string
}

/** A complete HTML page that prints as the document. */
export function printableHTML(document: WriterDocument, options: PrintOptions): string {
  const { page } = document
  const pageCSS = `@page {
  size: ${mm(page.width)} ${mm(page.height)};
  margin: ${mm(page.margins.top)} ${mm(page.margins.right)} ${mm(page.margins.bottom)} ${mm(page.margins.left)};
  ${marginBoxes(document.header, 'top')}
  ${marginBoxes(document.footer, 'bottom')}
}`
  const watermark = document.watermark
    ? `<div class="writer-watermark" aria-hidden="true"><span>${escapeText(document.watermark.text)}</span></div>`
    : ''
  const footnotes = options.footnotes?.length
    ? `<ol class="writer-footnotes">${options.footnotes.map((note) => `<li>${escapeText(note)}</li>`).join('')}</ol>`
    : ''
  const fonts = options.fontsStylesheet
    ? `<link rel="stylesheet" href="${escapeText(options.fontsStylesheet)}">`
    : ''
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeText(document.title)}</title>${fonts}<style>${pageCSS}${PRINT_CONTENT_CSS}</style></head><body>${watermark}${options.bodyHTML}${footnotes}</body></html>`
}

/** Prints the page from a hidden frame; the browser's dialog offers Save as PDF. */
export function printHTML(html: string): Promise<void> {
  return new Promise((resolve) => {
    const frame = document.createElement('iframe')
    frame.setAttribute('aria-hidden', 'true')
    frame.style.position = 'fixed'
    frame.style.width = '0'
    frame.style.height = '0'
    frame.style.border = '0'
    frame.srcdoc = html
    frame.addEventListener(
      'load',
      () => {
        const view = frame.contentWindow
        const finish = () => {
          frame.remove()
          resolve()
        }
        if (!view) return finish()
        view.addEventListener('afterprint', () => setTimeout(finish, 0), { once: true })
        // Fonts must be in before the page lays out for print.
        void view.document.fonts.ready.then(() => view.print())
      },
      { once: true }
    )
    document.body.append(frame)
  })
}
