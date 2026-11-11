import type { Element } from '@xmldom/xmldom'
import { compact } from 'es-toolkit'

import { detectDirection, type WriterMark, type WriterNode } from '#core/writer/model'

import { resolvePath, type ReadContext } from './context'
import { imageDataURL } from './images'
import { HIGHLIGHT_COLORS } from './runs'
import { attrOf, find, kid, kids, toggleOf, valOf } from './xml'

const EMU_PER_PX = 9525

const HEX = /^[0-9a-f]{6}$/i

/** On/off and vertical-alignment marks of a run. */
function toggleMarks(rPr: Element, rtl: boolean): WriterMark[] {
  const pick = (latin: boolean | null, complex: boolean | null) =>
    rtl ? (complex ?? latin) : (latin ?? complex)
  const marks: WriterMark[] = []
  if (pick(toggleOf(rPr, 'b'), toggleOf(rPr, 'bCs'))) marks.push({ type: 'bold' })
  if (pick(toggleOf(rPr, 'i'), toggleOf(rPr, 'iCs'))) marks.push({ type: 'italic' })
  if (kid(rPr, 'u') && valOf(rPr, 'u') !== 'none') marks.push({ type: 'underline' })
  if (toggleOf(rPr, 'strike') || toggleOf(rPr, 'dstrike')) marks.push({ type: 'strike' })
  const vertAlign = valOf(rPr, 'vertAlign')
  if (vertAlign === 'superscript' || vertAlign === 'subscript') marks.push({ type: vertAlign })
  return marks
}

function backgroundColor(rPr: Element): string | null {
  const highlight = valOf(rPr, 'highlight')
  if (highlight && HIGHLIGHT_COLORS[highlight]) return HIGHLIGHT_COLORS[highlight]
  const fill = attrOf(kid(rPr, 'shd'), 'fill')
  return fill && HEX.test(fill) ? `#${fill.toLowerCase()}` : null
}

/** Font, size, and colours of a run as one `textStyle` mark's attributes. */
function textStyle(rPr: Element, rtl: boolean): Record<string, string> {
  const pick = (latin: string | null, complex: string | null) =>
    rtl ? (complex ?? latin) : (latin ?? complex)
  const fonts = kid(rPr, 'rFonts')
  const style: Record<string, string> = {}
  const font = pick(attrOf(fonts, 'ascii') ?? attrOf(fonts, 'hAnsi'), attrOf(fonts, 'cs'))
  if (font) style.fontFamily = font
  const size = Number(pick(valOf(rPr, 'sz'), valOf(rPr, 'szCs')))
  if (size > 0) style.fontSize = `${size / 2}pt`
  const color = valOf(rPr, 'color')
  if (color && HEX.test(color)) style.color = `#${color.toLowerCase()}`
  const background = backgroundColor(rPr)
  if (background) style.backgroundColor = background
  return style
}

/** Run formatting as marks; complex-script values win for right-to-left text, as Word draws it. */
export function runMarks(rPr: Element | null, sample: string): WriterMark[] {
  if (!rPr) return []
  const rtl = detectDirection(sample) === 'rtl'
  const marks = toggleMarks(rPr, rtl)
  const style = textStyle(rPr, rtl)
  if (Object.keys(style).length) marks.push({ type: 'textStyle', attrs: style })
  return marks
}

/** Inline content of a paragraph, plus where page breaks fall in it. */
export type InlineItem = WriterNode | { type: '__pageBreak' }

export interface InlineState {
  context: ReadContext
  comments: string[]
  /** Inside a complex field: its instruction, and whether its result is being skipped. */
  field: { instruction: string; skip: boolean; separated: boolean } | null
}

function lineBreak(child: Element, state: InlineState): InlineItem[] {
  if (attrOf(child, 'type') === 'page') return [{ type: '__pageBreak' }]
  return state.field?.skip ? [] : [{ type: 'hardBreak' }]
}

/** A complex field's begin, separate, or end mark; page fields become their nodes. */
function fieldCharacter(child: Element, rPr: Element | null, state: InlineState): InlineItem[] {
  const type = attrOf(child, 'fldCharType')
  if (type === 'begin') state.field = { instruction: '', skip: false, separated: false }
  if (type === 'end') state.field = null
  if (type !== 'separate' || !state.field) return []
  const field = fieldNode(state.field.instruction, rPr)
  state.field.skip = field !== null
  state.field.separated = true
  return field ? [field] : []
}

export function readRun(run: Element, state: InlineState, extra: WriterMark[]): InlineItem[] {
  const rPr = kid(run, 'rPr')
  const out: InlineItem[] = []
  const commentMarks = state.comments.map((commentId) => ({
    type: 'comment',
    attrs: { commentId }
  }))
  const pushText = (value: string) => {
    if (!value) return
    if (state.field?.skip) return
    const marks = [...runMarks(rPr, value), ...extra, ...commentMarks]
    const node: WriterNode = { type: 'text', text: value }
    out.push(marks.length ? { ...node, marks } : node)
  }
  for (const child of kids(run)) {
    switch (child.localName) {
      case 't':
      case 'delText':
        pushText(child.textContent ?? '')
        break
      case 'tab':
        pushText('\t')
        break
      case 'br':
      case 'cr':
        out.push(...lineBreak(child, state))
        break
      case 'drawing':
      case 'pict':
        if (!state.field?.skip) out.push(...compact([readDrawing(child, state.context)]))
        break
      case 'footnoteReference':
        out.push({ type: 'footnote', attrs: { id: `fn${attrOf(child, 'id') ?? ''}` } })
        break
      case 'fldChar':
        out.push(...fieldCharacter(child, rPr, state))
        break
      case 'instrText':
        if (state.field) state.field.instruction += child.textContent ?? ''
        break
      default:
        break
    }
  }
  return out
}

const PAGE_FIELDS: Record<string, string | undefined> = {
  PAGE: 'pageNumber',
  NUMPAGES: 'pageCount'
}

export function fieldNode(instruction: string, rPr: Element | null): WriterNode | null {
  const name = instruction.trim().split(/\s+/)[0].toUpperCase()
  const marks = runMarks(rPr, '1')
  const base = PAGE_FIELDS[name]
  if (!base) return null
  return marks.length ? { type: base, marks } : { type: base }
}

export function readDrawing(drawing: Element, context: ReadContext): WriterNode | null {
  const blip = find(drawing, 'blip') ?? find(drawing, 'imagedata')
  const rid = attrOf(blip, 'embed') ?? attrOf(blip, 'id')
  const rel = rid ? context.rels.get(rid) : undefined
  if (!rel || rel.external) return null
  const path = resolvePath(context.base, rel.target)
  const bytes: Uint8Array | undefined = context.files[path]
  if (!bytes) return null
  const extent = find(drawing, 'extent')
  const cx = Number(attrOf(extent, 'cx') ?? 0)
  const cy = Number(attrOf(extent, 'cy') ?? 0)
  const docPr = find(drawing, 'docPr')
  const attrs: Record<string, unknown> = { src: imageDataURL(bytes, path) }
  if (cx > 0) attrs.width = Math.round(cx / EMU_PER_PX)
  if (cy > 0) attrs.height = Math.round(cy / EMU_PER_PX)
  const alt = attrOf(docPr, 'descr')
  if (alt) attrs.alt = alt
  return { type: 'image', attrs }
}

function linkMark(child: Element, context: ReadContext): WriterMark[] {
  const rid = attrOf(child, 'id')
  const anchor = attrOf(child, 'anchor')
  const rel = rid ? context.rels.get(rid) : undefined
  const href = rel?.target ?? (anchor ? `#${anchor}` : null)
  return href ? [{ type: 'link', attrs: { href } }] : []
}

function changeMark(type: 'insertion' | 'deletion', child: Element): WriterMark {
  return {
    type,
    attrs: { author: attrOf(child, 'author') ?? '', date: attrOf(child, 'date') ?? '' }
  }
}

export function readInlines(
  parent: Element,
  state: InlineState,
  extra: WriterMark[]
): InlineItem[] {
  const out: InlineItem[] = []
  for (const child of kids(parent)) {
    switch (child.localName) {
      case 'r':
        out.push(...readRun(child, state, extra))
        break
      case 'hyperlink':
        out.push(...readInlines(child, state, [...extra, ...linkMark(child, state.context)]))
        break
      case 'ins':
      case 'moveTo':
        out.push(...readInlines(child, state, [...extra, changeMark('insertion', child)]))
        break
      case 'del':
      case 'moveFrom':
        out.push(...readInlines(child, state, [...extra, changeMark('deletion', child)]))
        break
      case 'commentRangeStart':
        state.comments.push(`c${attrOf(child, 'id') ?? ''}`)
        break
      case 'commentRangeEnd':
        state.comments = state.comments.filter((open) => open !== `c${attrOf(child, 'id') ?? ''}`)
        break
      case 'fldSimple': {
        const field = fieldNode(attrOf(child, 'instr') ?? '', kid(find(child, 'r'), 'rPr'))
        if (field) out.push(field)
        else out.push(...readInlines(child, state, extra))
        break
      }
      case 'sdt':
        out.push(...readContentControl(child, state, extra))
        break
      case 'smartTag':
      case 'customXml':
        out.push(...readInlines(child, state, extra))
        break
      default:
        break
    }
  }
  return out
}

/** Lawha's own fillable fields come back as fields; other content controls as their content. */
export function readContentControl(
  sdt: Element,
  state: InlineState,
  extra: WriterMark[]
): InlineItem[] {
  const sdtPr = kid(sdt, 'sdtPr')
  const tag = valOf(sdtPr, 'tag') ?? ''
  const content = kid(sdt, 'sdtContent')
  const match = /^lawha:(text|date|checkbox):(.*)$/s.exec(tag)
  if (match && content) {
    const kind = match[1]
    const name = match[2]
    if (kind === 'checkbox') {
      const checked = attrOf(find(sdtPr, 'checked'), 'val') === '1'
      return [{ type: 'formField', attrs: { kind, name, value: '', checked } }]
    }
    const placeholder = kid(sdtPr, 'showingPlcHdr') !== null
    const value = placeholder ? '' : (content.textContent ?? '')
    return [{ type: 'formField', attrs: { kind, name, value, checked: false } }]
  }
  return content ? readInlines(content, state, extra) : []
}
