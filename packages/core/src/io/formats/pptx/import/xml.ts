import { DOMParser, type Element } from '@xmldom/xmldom'
import { unzipSync } from 'fflate'
import { dirname, join, normalize } from 'pathe'

// A package relationship, as the Word reader keeps them: both read OOXML packages.
import type { Relationship } from '#core/writer/docx/context'

/** OOXML reading helpers: elements by local name, so any namespace prefix reads the same. */

export function parseXML(bytes: Uint8Array | undefined): Element | null {
  if (!bytes) return null
  const source = new TextDecoder().decode(bytes)
  // xmldom rejects a byte-order mark in front of the XML declaration.
  const markup = source.startsWith('﻿') ? source.slice(1) : source
  try {
    const doc = new DOMParser({
      onError: (level, message) => {
        if (level !== 'warning') throw new Error(message)
      }
    }).parseFromString(markup, 'application/xml')
    return doc.documentElement ?? null
  } catch {
    return null
  }
}

/** Element children, or only those with this local name. */
export function children(el: Element | null | undefined, name?: string): Element[] {
  if (!el) return []
  const out: Element[] = []
  for (let node = el.firstChild; node; node = node.nextSibling) {
    if (node.nodeType !== 1) continue
    const element = node as Element
    if (!name || element.localName === name) out.push(element)
  }
  return out
}

/** The first child with this local name. */
export function child(el: Element | null | undefined, name: string): Element | undefined {
  if (!el) return undefined
  for (let node = el.firstChild; node; node = node.nextSibling) {
    if (node.nodeType === 1 && (node as Element).localName === name) return node as Element
  }
  return undefined
}

/** The element down this path of local names. */
export function descend(el: Element | null | undefined, ...names: string[]): Element | undefined {
  let current: Element | undefined = el ?? undefined
  for (const name of names) current = child(current, name)
  return current
}

/** An attribute by its local name, whatever its prefix (`r:embed` reads as `embed`). */
export function attr(el: Element | null | undefined, name: string): string | null {
  if (!el) return null
  if (el.hasAttribute(name)) return el.getAttribute(name)
  const attributes = el.attributes
  for (let i = 0; i < attributes.length; i++) {
    const item = attributes.item(i)
    if (item && (item.localName === name || item.name.endsWith(`:${name}`))) return item.value
  }
  return null
}

/** A relationship reference (`r:id`, `r:embed`), whatever the relationships prefix is. */
export function relAttr(el: Element | null | undefined, name: string): string | null {
  if (!el) return null
  const attributes = el.attributes
  for (let i = 0; i < attributes.length; i++) {
    const item = attributes.item(i)
    if (item?.localName === name && item.namespaceURI?.endsWith('/relationships')) return item.value
  }
  return null
}

export function numAttr(el: Element | null | undefined, name: string): number | null {
  const value = attr(el, name)
  if (value === null || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** OOXML booleans are `1`/`true` or `0`/`false`. */
export function boolAttr(el: Element | null | undefined, name: string): boolean | null {
  const value = attr(el, name)
  if (value === null) return null
  return value === '1' || value === 'true'
}

/** An unzipped OOXML package: parts by path, their relationships resolved to part paths. */
export class OOXMLPackage {
  private readonly files: Record<string, Uint8Array>
  private readonly parsed = new Map<string, Element | null>()

  constructor(bytes: Uint8Array) {
    this.files = unzipSync(bytes)
  }

  bytes(part: string): Uint8Array | undefined {
    return this.files[part]
  }

  xml(part: string): Element | null {
    if (!this.parsed.has(part)) this.parsed.set(part, parseXML(this.files[part]))
    return this.parsed.get(part) ?? null
  }

  /** A part's relationships by id, targets resolved against the part's folder. */
  rels(part: string): Map<string, Relationship> {
    const relsPart = join(dirname(part), '_rels', `${part.split('/').pop() ?? ''}.rels`)
    const out = new Map<string, Relationship>()
    for (const rel of children(this.xml(relsPart), 'Relationship')) {
      const id = attr(rel, 'Id')
      const target = attr(rel, 'Target')
      if (!id || !target) continue
      const external = attr(rel, 'TargetMode') === 'External'
      out.set(id, {
        type: attr(rel, 'Type') ?? '',
        target: external ? target : resolvePart(part, target),
        external
      })
    }
    return out
  }

  /** The first related part of a relationship type ending in `kind` (`slideLayout`, `theme`). */
  related(part: string, kind: string): string | null {
    for (const rel of this.rels(part).values()) {
      if (!rel.external && rel.type.endsWith(`/${kind}`)) return rel.target
    }
    return null
  }
}

function resolvePart(from: string, target: string): string {
  if (target.startsWith('/')) return normalize(target.slice(1))
  return normalize(join(dirname(from), target))
}
