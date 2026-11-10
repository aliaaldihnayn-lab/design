import { DOMParser, type Element } from '@xmldom/xmldom'
import { escapeAttribute } from 'entities'

export const NS = {
  w: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  wp: 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  pic: 'http://schemas.openxmlformats.org/drawingml/2006/picture',
  pkgRels: 'http://schemas.openxmlformats.org/package/2006/relationships',
  contentTypes: 'http://schemas.openxmlformats.org/package/2006/content-types'
} as const

export const REL = {
  officeDocument:
    'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument',
  coreProperties:
    'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties',
  styles: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles',
  numbering: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering',
  settings: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings',
  comments: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments',
  footnotes: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes',
  header: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header',
  footer: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer',
  image: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image',
  hyperlink: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink'
} as const

export const attr = (value: string | number) => escapeAttribute(String(value))

/** An element with attributes, empty when it has no children. */
export function el(
  name: string,
  attrs: Record<string, string | number | undefined> = {},
  children = ''
): string {
  const list = Object.entries(attrs)
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined)
    .map(([key, value]) => ` ${key}="${attr(value)}"`)
    .join('')
  return children ? `<${name}${list}>${children}</${name}>` : `<${name}${list}/>`
}

export const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'

export function parseXML(source: string): Element | null {
  const markup = source.startsWith('﻿') ? source.slice(1) : source
  try {
    const parsed = new DOMParser({
      onError: (level, message) => {
        if (level === 'fatalError') throw new Error(message)
      }
    }).parseFromString(markup, 'application/xml')
    return parsed.documentElement
  } catch {
    return null
  }
}

/** Element children, optionally only those of one local name. */
export function kids(parent: Element | null | undefined, name?: string): Element[] {
  if (!parent) return []
  const out: Element[] = []
  for (let node = parent.firstChild; node; node = node.nextSibling) {
    if (node.nodeType !== 1) continue
    const element = node as Element
    if (name === undefined || element.localName === name) out.push(element)
  }
  return out
}

export function kid(parent: Element | null | undefined, name: string): Element | null {
  return kids(parent, name)[0] ?? null
}

/** First descendant of the local name. */
export function find(parent: Element | null | undefined, name: string): Element | null {
  if (!parent) return null
  for (const child of kids(parent)) {
    if (child.localName === name) return child
    const found = find(child, name)
    if (found) return found
  }
  return null
}

/** An attribute by local name, whatever its prefix (`w:val`, `r:id`). */
export function attrOf(element: Element | null | undefined, name: string): string | null {
  if (!element) return null
  const attrs = element.attributes
  for (let i = 0; i < attrs.length; i += 1) {
    const item = attrs.item(i)
    if (item && (item.localName === name || item.name === name)) return item.value
  }
  return null
}

/** `w:val` of a child, as for `<w:jc w:val="center"/>`. */
export function valOf(parent: Element | null | undefined, name: string): string | null {
  return attrOf(kid(parent, name), 'val')
}

/** On/off properties (`<w:b/>`, `<w:b w:val="0"/>`): null when absent. */
export function toggleOf(parent: Element | null | undefined, name: string): boolean | null {
  const child = kid(parent, name)
  if (!child) return null
  const value = attrOf(child, 'val')
  return value === null || !['0', 'false', 'off', 'none'].includes(value)
}

/** Namespaces every part with body content declares. */
export const DOCUMENT_NAMESPACES =
  `xmlns:w="${NS.w}" xmlns:r="${NS.r}" xmlns:wp="${NS.wp}" xmlns:a="${NS.a}" xmlns:pic="${NS.pic}" ` +
  'xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" ' +
  'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" ' +
  'xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" ' +
  'mc:Ignorable="w14"'
