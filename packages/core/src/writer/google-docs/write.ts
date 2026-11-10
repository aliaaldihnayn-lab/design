import { converter } from 'culori'

import { tableGrid } from '#core/writer/docx/tables'
import {
  detectDirection,
  hasMark,
  markAttr,
  nodeText,
  numberAttr,
  stringAttr,
  type WriterDocument,
  type WriterNode
} from '#core/writer/model'

import type { GoogleDocsRequest, GoogleDocument, GoogleTextStyle } from './types'

/**
 * The `documents.batchUpdate` requests that make a Google Doc's body the model's body: the old
 * content is deleted, then each block is inserted at the start in reverse order, so every
 * insertion's index is known without measuring what Docs made of the ones before it. Paragraph
 * styles, direction, text styles, links, lists, page breaks, and tables with merged cells are
 * written; images, page-number fields and the header and footer stay as the Doc has them.
 */

const TEXT_STYLE_FIELDS =
  'bold,italic,underline,strikethrough,baselineOffset,fontSize,weightedFontFamily,foregroundColor,backgroundColor,link'

const toRGB = converter('rgb')

function rgb(value: unknown) {
  const color = typeof value === 'string' ? toRGB(value) : undefined
  return color ? { color: { rgbColor: { red: color.r, green: color.g, blue: color.b } } } : null
}

function fontSize(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const match = /^([\d.]+)(pt|px)?$/.exec(value.trim())
  if (!match) return null
  return match[2] === 'px' ? Number(match[1]) * 0.75 : Number(match[1])
}

export function googleTextStyle(node: WriterNode): { style: GoogleTextStyle; fields: string[] } {
  const style: GoogleTextStyle = {}
  const fields: string[] = []
  const set = <K extends keyof GoogleTextStyle>(key: K, value: GoogleTextStyle[K] | null) => {
    if (value === null || value === undefined) return
    style[key] = value
    fields.push(key)
  }
  if (hasMark(node, 'bold')) set('bold', true)
  if (hasMark(node, 'italic')) set('italic', true)
  if (hasMark(node, 'underline')) set('underline', true)
  if (hasMark(node, 'strike')) set('strikethrough', true)
  if (hasMark(node, 'superscript')) set('baselineOffset', 'SUPERSCRIPT')
  if (hasMark(node, 'subscript')) set('baselineOffset', 'SUBSCRIPT')
  const family = markAttr(node, 'textStyle', 'fontFamily')
  if (typeof family === 'string' && family)
    set('weightedFontFamily', { fontFamily: family.split(',')[0].replace(/["']/g, '').trim() })
  const size = fontSize(markAttr(node, 'textStyle', 'fontSize'))
  if (size) set('fontSize', { magnitude: size, unit: 'PT' })
  set('foregroundColor', rgb(markAttr(node, 'textStyle', 'color')))
  const background =
    rgb(markAttr(node, 'textStyle', 'backgroundColor')) ??
    (hasMark(node, 'highlight')
      ? (rgb(markAttr(node, 'highlight', 'color')) ?? rgb('#ffff00'))
      : null)
  set('backgroundColor', background)
  const href = markAttr(node, 'link', 'href')
  if (typeof href === 'string' && href) set('link', { url: href })
  return { style, fields }
}

/** A stretch of the inserted text, by offset, and the node it came from. */
interface Span {
  offset: number
  length: number
  node: WriterNode
}

/** Plain text of a block's inline content, with the runs that need a text style. */
function inlineText(node: WriterNode, offset: number, runs: Span[]): string {
  let text = ''
  for (const child of node.content ?? []) {
    if (child.type === 'text' && child.text) {
      // A deletion still pending in track changes is not part of the document Docs gets.
      if (hasMark(child, 'deletion')) continue
      const value = child.text.replaceAll('\n', '\u000b')
      runs.push({ offset: offset + text.length, length: value.length, node: child })
      text += value
    } else if (child.type === 'hardBreak') text += '\u000b'
    else if (child.type === 'formField') text += stringAttr(child.attrs, 'value') ?? ''
  }
  return text
}

function paragraphStyle(node: WriterNode): Record<string, string> {
  const level = node.type === 'heading' ? (numberAttr(node.attrs, 'level') ?? 1) : null
  const dir = stringAttr(node.attrs, 'dir')
  const rtl = dir === 'rtl' || (dir !== 'ltr' && detectDirection(nodeText(node)) === 'rtl')
  const align = stringAttr(node.attrs, 'textAlign')
  const startEdge = rtl ? 'right' : 'left'
  let alignment = 'START'
  if (align === 'center') alignment = 'CENTER'
  else if (align === 'justify') alignment = 'JUSTIFIED'
  else if (align && align !== startEdge) alignment = 'END'
  return {
    namedStyleType: level ? `HEADING_${Math.min(6, level)}` : 'NORMAL_TEXT',
    alignment,
    direction: rtl ? 'RIGHT_TO_LEFT' : 'LEFT_TO_RIGHT'
  }
}

interface TextChunk {
  kind: 'text'
  paragraphs: WriterNode[]
  /** Nesting level per paragraph; set for list chunks. */
  levels?: number[]
  ordered?: boolean
}

type Chunk = TextChunk | { kind: 'table'; node: WriterNode } | { kind: 'pageBreak' }

function listItems(list: WriterNode, level: number, out: TextChunk): void {
  for (const item of list.content ?? []) {
    for (const child of item.content ?? []) {
      if (child.type === 'bulletList' || child.type === 'orderedList')
        listItems(child, level + 1, out)
      else if (child.type === 'paragraph' || child.type === 'heading') {
        out.paragraphs.push(child)
        out.levels?.push(level)
      }
    }
  }
}

function chunksOf(blocks: readonly WriterNode[]): Chunk[] {
  const chunks: Chunk[] = []
  for (const block of blocks) {
    const last = chunks.at(-1)
    if (block.type === 'paragraph' || block.type === 'heading') {
      if (last?.kind === 'text' && !last.levels) last.paragraphs.push(block)
      else chunks.push({ kind: 'text', paragraphs: [block] })
    } else if (block.type === 'bulletList' || block.type === 'orderedList') {
      const chunk: TextChunk = {
        kind: 'text',
        paragraphs: [],
        levels: [],
        ordered: block.type === 'orderedList'
      }
      listItems(block, 0, chunk)
      chunks.push(chunk)
    } else if (block.type === 'table') chunks.push({ kind: 'table', node: block })
    else if (block.type === 'pageBreak') chunks.push({ kind: 'pageBreak' })
  }
  return chunks
}

const range = (startIndex: number, endIndex: number) => ({ startIndex, endIndex })

/** Requests inserting a text chunk at `index`; inside a table cell, without a final newline. */
function textChunkRequests(chunk: TextChunk, index: number, inCell: boolean): GoogleDocsRequest[] {
  const runs: Span[] = []
  const paragraphs: Span[] = []
  let text = ''
  chunk.paragraphs.forEach((paragraph, i) => {
    const tabs = '\t'.repeat(chunk.levels?.[i] ?? 0)
    const offset = text.length
    const body = tabs + inlineText(paragraph, offset + tabs.length, runs)
    paragraphs.push({ offset, length: body.length, node: paragraph })
    text += `${body}\n`
  })
  if (inCell) text = text.slice(0, -1)
  if (!text) return []
  const end = index + text.length
  const requests: GoogleDocsRequest[] = [
    { insertText: { location: { index }, text } },
    { updateTextStyle: { range: range(index, end), textStyle: {}, fields: TEXT_STYLE_FIELDS } }
  ]
  for (const paragraph of paragraphs) {
    const start = index + paragraph.offset
    requests.push({
      updateParagraphStyle: {
        range: range(start, start + paragraph.length + 1),
        paragraphStyle: paragraphStyle(paragraph.node),
        fields: 'namedStyleType,alignment,direction'
      }
    })
  }
  for (const run of runs) {
    const { style, fields } = googleTextStyle(run.node)
    if (!fields.length) continue
    requests.push({
      updateTextStyle: {
        range: range(index + run.offset, index + run.offset + run.length),
        textStyle: style,
        fields: fields.join(',')
      }
    })
  }
  if (chunk.levels) {
    requests.push({
      createParagraphBullets: {
        range: range(index, end),
        bulletPreset: chunk.ordered ? 'NUMBERED_DECIMAL_ALPHA_ROMAN' : 'BULLET_DISC_CIRCLE_SQUARE'
      }
    })
  } else if (!inCell) requests.push({ deleteParagraphBullets: { range: range(index, end) } })
  return requests
}

/**
 * A table inserted at `index`: Docs puts a newline before it, then for each row a row marker
 * and for each cell a cell marker and an empty paragraph, so cell (r, c) starts its text at
 * index + 4 + r(2·columns + 1) + 2c. Cells are filled last first, then merged.
 */
function tableRequests(table: WriterNode, index: number): GoogleDocsRequest[] {
  const grid = tableGrid(table.content ?? [])
  const rows = grid.rows.length
  const columns = grid.columns
  if (!rows || !columns) return []
  const requests: GoogleDocsRequest[] = [{ insertTable: { rows, columns, location: { index } } }]
  const fills: GoogleDocsRequest[][] = []
  const merges: GoogleDocsRequest[] = []
  grid.rows.forEach((row, r) => {
    for (const slot of row) {
      if (slot.kind !== 'start') continue
      const cellIndex = index + 4 + r * (2 * columns + 1) + 2 * slot.column
      const blocks = (slot.cell.content ?? []).filter(
        (block) => block.type === 'paragraph' || block.type === 'heading'
      )
      fills.push(textChunkRequests({ kind: 'text', paragraphs: blocks }, cellIndex, true))
      const rowSpan = numberAttr(slot.cell.attrs, 'rowspan') ?? 1
      const columnSpan = numberAttr(slot.cell.attrs, 'colspan') ?? 1
      if (rowSpan > 1 || columnSpan > 1) {
        merges.push({
          mergeTableCells: {
            tableRange: {
              tableCellLocation: {
                tableStartLocation: { index: index + 1 },
                rowIndex: r,
                columnIndex: slot.column
              },
              rowSpan,
              columnSpan
            }
          }
        })
      }
    }
  })
  return [...requests, ...fills.reverse().flat(), ...merges]
}

const pt = (twips: number) => ({ magnitude: twips / 20, unit: 'PT' })

/** Every request that makes `current`'s body and page setup the model's. */
export function googleDocsRequests(
  model: WriterDocument,
  current: GoogleDocument
): GoogleDocsRequest[] {
  const requests: GoogleDocsRequest[] = []
  const end = current.body?.content?.at(-1)?.endIndex ?? 1
  if (end - 1 > 1) requests.push({ deleteContentRange: { range: range(1, end - 1) } })
  const { page } = model
  requests.push({
    updateDocumentStyle: {
      documentStyle: {
        pageSize: { width: pt(page.width), height: pt(page.height) },
        marginTop: pt(page.margins.top),
        marginBottom: pt(page.margins.bottom),
        marginLeft: pt(page.margins.left),
        marginRight: pt(page.margins.right),
        marginHeader: pt(page.margins.header),
        marginFooter: pt(page.margins.footer)
      },
      fields: 'pageSize,marginTop,marginBottom,marginLeft,marginRight,marginHeader,marginFooter'
    }
  })
  for (const chunk of chunksOf(model.body.content ?? []).reverse()) {
    if (chunk.kind === 'text') requests.push(...textChunkRequests(chunk, 1, false))
    else if (chunk.kind === 'table') requests.push(...tableRequests(chunk.node, 1))
    else requests.push({ insertPageBreak: { location: { index: 1 } } })
  }
  return requests
}
