import { XMLSerializer, type Document, type Element, type Node } from '@xmldom/xmldom'
import { strFromU8, strToU8 } from 'fflate'

import { DOCUMENT_NAMESPACES, kids, parseXML, XML_HEADER } from '#core/writer/docx/xml'

/**
 * Tree edits on parsed package parts. xmldom implements DOM Level 2 without the ChildNode
 * methods (`before`, `replaceWith`), so insertion goes through `insertBefore` here alone.
 */

/** Parts of a package being patched, by path; assigning a path replaces or adds the part. */
export type MutableFiles = Record<string, Uint8Array>

/** Inserts `node` before `reference`, or last when there is none. */
export function insertBefore(parent: Element, node: Node, reference: Node | null): void {
  // eslint-disable-next-line unicorn/prefer-modern-dom-apis -- xmldom has no ChildNode.before
  parent.insertBefore(node, reference)
}

export function replaceNode(old: Element, replacement: Node): void {
  const parent = old.parentNode
  if (!parent) return
  // eslint-disable-next-line unicorn/prefer-modern-dom-apis -- xmldom has no ChildNode.replaceWith
  parent.replaceChild(replacement, old)
}

/** The document a parsed element belongs to; every element xmldom parses has one. */
export function ownerOf(element: Element): Document {
  const owner = element.ownerDocument
  if (!owner) throw new Error('element has no document')
  return owner
}

/** A copy of `element` owned by `owner`'s document. */
export function adopt(owner: Document, element: Element): Element {
  return owner.importNode(element, true)
}

export function readPart(files: MutableFiles, path: string): Element | null {
  return path in files ? parseXML(strFromU8(files[path])) : null
}

export function writePart(files: MutableFiles, path: string, root: Element): void {
  files[path] = strToU8(XML_HEADER + new XMLSerializer().serializeToString(root))
}

/** Elements of WordprocessingML markup, owned by `owner`'s document, ready to insert. */
export function importMarkup(owner: Element, xml: string): Element[] {
  const wrapper = parseXML(`<w:wrapper ${DOCUMENT_NAMESPACES}>${xml}</w:wrapper>`)
  const target = ownerOf(owner)
  if (!wrapper) return []
  return kids(wrapper).map((child) => adopt(target, child))
}
