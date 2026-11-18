import { formatHex, parse } from 'culori'

import { detectDirection, markAttr, hasMark, type WriterNode } from '#core/writer/model'

import { el } from './xml'

/** `12pt`, `16px`, or a bare number of points, as points. */
export function fontSizePt(value: unknown): number | null {
  if (typeof value === 'number') return value
  if (typeof value !== 'string') return null
  const match = /^\s*([\d.]+)\s*(pt|px)?\s*$/i.exec(value)
  if (!match) return null
  const size = Number(match[1])
  if (!Number.isFinite(size) || size <= 0) return null
  return match[2]?.toLowerCase() === 'px' ? size * 0.75 : size
}

/** A CSS colour as Word's `RRGGBB`, or null. */
export function wordColor(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null
  const parsed = parse(value)
  if (!parsed) return null
  return formatHex(parsed).slice(1).toUpperCase()
}

const HIGHLIGHT_NAMES: Record<string, string> = {
  FFFF00: 'yellow',
  '00FF00': 'green',
  '00FFFF': 'cyan',
  FF00FF: 'magenta',
  '0000FF': 'blue',
  FF0000: 'red',
  '000080': 'darkBlue',
  '008080': 'darkCyan',
  '008000': 'darkGreen',
  '800080': 'darkMagenta',
  '800000': 'darkRed',
  '808000': 'darkYellow',
  '808080': 'darkGray',
  C0C0C0: 'lightGray',
  '000000': 'black'
}

export const HIGHLIGHT_COLORS: Record<string, string> = Object.fromEntries(
  Object.entries(HIGHLIGHT_NAMES).map(([hex, name]) => [name, `#${hex.toLowerCase()}`])
)

function fontProperties(node: WriterNode): string {
  const font = markAttr(node, 'textStyle', 'fontFamily')
  if (typeof font !== 'string' || !font) return ''
  const family = font
    .split(',')[0]
    .trim()
    .replace(/^["']|["']$/g, '')
  return el('w:rFonts', {
    'w:ascii': family,
    'w:hAnsi': family,
    'w:cs': family,
    'w:eastAsia': family
  })
}

function sizeProperties(node: WriterNode): string {
  const size = fontSizePt(markAttr(node, 'textStyle', 'fontSize'))
  if (!size) return ''
  const half = Math.round(size * 2)
  return el('w:sz', { 'w:val': half }) + el('w:szCs', { 'w:val': half })
}

function highlightColor(node: WriterNode): string | null {
  return hasMark(node, 'highlight')
    ? (wordColor(markAttr(node, 'highlight', 'color')) ?? 'FFFF00')
    : wordColor(markAttr(node, 'textStyle', 'backgroundColor'))
}

/** `<w:rPr>` for a text node's marks, its children in the order the schema requires. */
export function runProperties(node: WriterNode, extra = ''): string {
  const flag = (type: string, xml: string) => (hasMark(node, type) ? xml : '')
  const color = wordColor(markAttr(node, 'textStyle', 'color'))
  const highlight = highlightColor(node)
  const named = highlight ? HIGHLIGHT_NAMES[highlight] : undefined
  const all = [
    extra,
    fontProperties(node),
    flag('bold', '<w:b/><w:bCs/>'),
    flag('italic', '<w:i/><w:iCs/>'),
    flag('strike', '<w:strike/>'),
    color ? el('w:color', { 'w:val': color }) : '',
    sizeProperties(node),
    named ? el('w:highlight', { 'w:val': named }) : '',
    flag('underline', el('w:u', { 'w:val': 'single' })),
    highlight && !named
      ? el('w:shd', { 'w:val': 'clear', 'w:color': 'auto', 'w:fill': highlight })
      : '',
    flag('superscript', el('w:vertAlign', { 'w:val': 'superscript' })),
    flag('subscript', el('w:vertAlign', { 'w:val': 'subscript' })),
    detectDirection(node.text ?? '') === 'rtl' ? '<w:rtl/>' : ''
  ].join('')
  return all ? `<w:rPr>${all}</w:rPr>` : ''
}
