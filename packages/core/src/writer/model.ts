/**
 * The word-processing document model shared by Lawha's document editor, its Word and Google
 * Docs converters, and the AI tools. Content is ProseMirror JSON, in the node and mark names of
 * the editor's schema (Tiptap), so the editor loads it without a translation step; page setup,
 * header, footer, and comments sit beside it the way Word keeps them beside the body.
 */

/** A mark on text: bold, a text style, a link, a comment, a tracked change. */
export interface WriterMark {
  type: string
  attrs?: Record<string, unknown>
}

/** A node in ProseMirror JSON form. */
export interface WriterNode {
  type: string
  attrs?: Record<string, unknown>
  content?: WriterNode[]
  marks?: WriterMark[]
  text?: string
}

export type TextDirection = 'ltr' | 'rtl' | 'auto'
export type TextAlign = 'left' | 'center' | 'right' | 'justify'

/** Twentieths of a point, Word's own unit for page geometry, so sizes round-trip exactly. */
export type Twips = number

export interface PageMargins {
  top: Twips
  right: Twips
  bottom: Twips
  left: Twips
  header: Twips
  footer: Twips
}

export interface PageSetup {
  width: Twips
  height: Twips
  margins: PageMargins
}

export interface WriterComment {
  id: string
  author: string
  initials?: string
  /** ISO 8601. */
  date: string
  text: string
  resolved?: boolean
}

export interface WriterFootnote {
  id: string
  /** Paragraph content of the note. */
  content: WriterNode[]
}

export interface WriterWatermark {
  text: string
  color?: string
}

/**
 * How unstyled text looks: Word's document defaults with its default paragraph style. Arabic
 * and Hebrew text uses the complex-script face and size where they differ.
 */
export interface WriterDefaults {
  fontFamily?: string
  fontFamilyComplex?: string
  /** Points. */
  fontSize?: number
  fontSizeComplex?: number
}

export interface WriterDocument {
  /** The body: a node of type `doc`. */
  body: WriterNode
  page: PageSetup
  /** A `doc` node drawn at the top of every page, or null. */
  header: WriterNode | null
  footer: WriterNode | null
  comments: WriterComment[]
  footnotes: WriterFootnote[]
  /** Record edits as tracked changes (Word's Track Changes). */
  trackChanges: boolean
  watermark: WriterWatermark | null
  title: string
  /** The document's default text style; the editor's own when left out. */
  defaults?: WriterDefaults | null
}

const MM_PER_INCH = 25.4
const TWIPS_PER_INCH = 1440
const TWIPS_PER_PT = 20
const PX_PER_INCH = 96

export const twipsToMM = (twips: Twips) => (twips / TWIPS_PER_INCH) * MM_PER_INCH
export const mmToTwips = (mm: number): Twips => Math.round((mm / MM_PER_INCH) * TWIPS_PER_INCH)
export const twipsToPx = (twips: Twips) => (twips / TWIPS_PER_INCH) * PX_PER_INCH
export const ptToTwips = (pt: number): Twips => Math.round(pt * TWIPS_PER_PT)

/** Paper sizes people pick from, in twips (portrait). */
export const PAGE_SIZES = {
  a4: { width: 11906, height: 16838 },
  a5: { width: 8391, height: 11906 },
  a3: { width: 16838, height: 23811 },
  letter: { width: 12240, height: 15840 },
  legal: { width: 12240, height: 20160 }
} as const satisfies Record<string, { width: Twips; height: Twips }>

export type PageSizeId = keyof typeof PAGE_SIZES
export const PAGE_SIZE_IDS = Object.keys(PAGE_SIZES) as PageSizeId[]

/** Word's default margins: one inch, header and footer half an inch from the edge. */
export const DEFAULT_MARGINS: PageMargins = {
  top: 1440,
  right: 1440,
  bottom: 1440,
  left: 1440,
  header: 720,
  footer: 720
}

export function defaultPageSetup(size: PageSizeId = 'a4'): PageSetup {
  return { ...PAGE_SIZES[size], margins: { ...DEFAULT_MARGINS } }
}

/** The named page size these dimensions are, in either orientation, or null for a custom one. */
export function pageSizeId(page: Pick<PageSetup, 'width' | 'height'>): PageSizeId | null {
  const short = Math.min(page.width, page.height)
  const long = Math.max(page.width, page.height)
  for (const id of PAGE_SIZE_IDS) {
    const size = PAGE_SIZES[id]
    if (Math.abs(size.width - short) <= 2 && Math.abs(size.height - long) <= 2) return id
  }
  return null
}

export function emptyBody(dir: TextDirection = 'rtl'): WriterNode {
  return { type: 'doc', content: [{ type: 'paragraph', attrs: { dir } }] }
}

export function createWriterDocument(options: Partial<WriterDocument> = {}): WriterDocument {
  return {
    body: emptyBody(),
    page: defaultPageSetup(),
    header: null,
    footer: null,
    comments: [],
    footnotes: [],
    trackChanges: false,
    watermark: null,
    title: '',
    ...options
  }
}

/** First strong character decides, as the Unicode bidi algorithm's paragraph level does. */
export function detectDirection(text: string): 'ltr' | 'rtl' | null {
  for (const char of text) {
    if (/[֐-ࣿיִ-﷿ﹰ-﻿]/u.test(char)) return 'rtl'
    if (/\p{L}/u.test(char)) return 'ltr'
  }
  return null
}

/** The plain text of a node, paragraphs separated by newlines. */
export function nodeText(node: WriterNode): string {
  if (node.type === 'text') return node.text ?? ''
  if (node.type === 'hardBreak') return '\n'
  const parts = (node.content ?? []).map(nodeText)
  return isBlockContainer(node) ? parts.join('\n') : parts.join('')
}

function isBlockContainer(node: WriterNode): boolean {
  return (node.content ?? []).some((child) => BLOCK_TYPES.has(child.type))
}

export const BLOCK_TYPES: ReadonlySet<string> = new Set([
  'paragraph',
  'heading',
  'bulletList',
  'orderedList',
  'listItem',
  'table',
  'tableRow',
  'tableCell',
  'tableHeader',
  'pageBreak',
  'blockquote',
  'tableOfContents',
  'sectionBreak'
])

export function hasMark(node: WriterNode, type: string): boolean {
  return (node.marks ?? []).some((mark) => mark.type === type)
}

export function markAttr(node: WriterNode, type: string, attr: string): unknown {
  return node.marks?.find((mark) => mark.type === type)?.attrs?.[attr]
}

export function stringAttr(attrs: Record<string, unknown> | undefined, key: string) {
  const value = attrs?.[key]
  return typeof value === 'string' && value !== '' ? value : null
}

export function numberAttr(attrs: Record<string, unknown> | undefined, key: string) {
  const value = attrs?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Visits every node depth first, parents before children. */
export function walkNodes(
  node: WriterNode,
  visit: (node: WriterNode, parent: WriterNode | null) => void,
  parent: WriterNode | null = null
): void {
  visit(node, parent)
  for (const child of node.content ?? []) walkNodes(child, visit, node)
}

/** Words, characters, and paragraphs, counted as Word counts them. */
export interface WriterStatistics {
  words: number
  characters: number
  charactersNoSpaces: number
  paragraphs: number
}

export function documentStatistics(body: WriterNode): WriterStatistics {
  let paragraphs = 0
  const texts: string[] = []
  walkNodes(body, (node) => {
    if (node.type === 'paragraph' || node.type === 'heading') {
      const text = nodeText(node)
      if (text.trim()) paragraphs += 1
      texts.push(text)
    }
  })
  const all = texts.join('\n')
  const words = all.split(/\s+/u).filter((word) => /[\p{L}\p{N}]/u.test(word)).length
  return {
    words,
    characters: texts.join('').length,
    charactersNoSpaces: texts.join('').replace(/\s/gu, '').length,
    paragraphs
  }
}
