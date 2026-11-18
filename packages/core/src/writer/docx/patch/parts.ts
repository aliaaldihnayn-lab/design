import type { Element } from '@xmldom/xmldom'
import { strToU8 } from 'fflate'

import { contentTypeFor } from '#core/writer/docx/images'
import { relsXML, type ListDefinition, type Relationship } from '#core/writer/docx/package'
import { numberingXML, stylesXML } from '#core/writer/docx/parts'
import { attrOf, kid, kids, NS, parseXML } from '#core/writer/docx/xml'

import { adopt, insertBefore, ownerOf, readPart, writePart, type MutableFiles } from './dom'

/** Shared parts a patched package updates: relationships, content types, lists, styles. */

export function relsPath(partPath: string): string {
  const slash = partPath.lastIndexOf('/')
  return `${partPath.slice(0, slash + 1)}_rels/${partPath.slice(slash + 1)}.rels`
}

export function readRelationships(files: MutableFiles, partPath: string): Relationship[] {
  return kids(readPart(files, relsPath(partPath)), 'Relationship').map((rel) => ({
    id: attrOf(rel, 'Id') ?? '',
    type: attrOf(rel, 'Type') ?? '',
    target: attrOf(rel, 'Target') ?? '',
    external: attrOf(rel, 'TargetMode') === 'External'
  }))
}

/** Rewrites a part's relationships when writing added some. */
export function writeRelationships(
  files: MutableFiles,
  partPath: string,
  before: readonly Relationship[],
  after: readonly Relationship[]
): void {
  if (after.length === before.length) return
  files[relsPath(partPath)] = strToU8(relsXML(after))
}

/** Declares parts' content types, and media extensions', in `[Content_Types].xml`. */
export function declareContentTypes(
  files: MutableFiles,
  overrides: ReadonlyArray<{ path: string; type: string }>,
  extensions: readonly string[]
): void {
  const root = readPart(files, '[Content_Types].xml')
  const owner = root ? ownerOf(root) : null
  if (!root || !owner) return
  let changed = false
  const defaults = new Set(kids(root, 'Default').map((entry) => attrOf(entry, 'Extension')))
  for (const extension of extensions) {
    if (defaults.has(extension)) continue
    defaults.add(extension)
    const entry = owner.createElementNS(NS.contentTypes, 'Default')
    entry.setAttribute('Extension', extension)
    entry.setAttribute('ContentType', contentTypeFor(extension))
    insertBefore(root, entry, root.firstChild)
    changed = true
  }
  const declared = new Set(kids(root, 'Override').map((entry) => attrOf(entry, 'PartName')))
  for (const { path, type } of overrides) {
    if (declared.has(`/${path}`)) continue
    const entry = owner.createElementNS(NS.contentTypes, 'Override')
    entry.setAttribute('PartName', `/${path}`)
    entry.setAttribute('ContentType', type)
    root.appendChild(entry)
    changed = true
  }
  if (changed) writePart(files, '[Content_Types].xml', root)
}

const highest = (values: ReadonlyArray<string | null>) =>
  Math.max(0, ...values.map(Number).filter(Number.isFinite))

/** The highest list numbers in use, so new lists number after them. */
export function numberingBases(files: MutableFiles, path: string) {
  const root = readPart(files, path)
  return {
    numIdBase: highest(kids(root, 'num').map((num) => attrOf(num, 'numId'))),
    abstractIdBase: highest(kids(root, 'abstractNum').map((num) => attrOf(num, 'abstractNumId')))
  }
}

/**
 * Adds new lists to the package's numbering: abstract definitions after the existing ones and
 * before the first `w:num`, as the schema orders them. Returns whether the part is new.
 */
export function mergeNumbering(
  files: MutableFiles,
  path: string,
  lists: readonly ListDefinition[]
): boolean {
  if (!lists.length) return false
  const generated = parseXML(numberingXML(lists))
  const root = readPart(files, path)
  const owner = root ? ownerOf(root) : null
  if (!root || !owner || !generated) {
    files[path] = strToU8(numberingXML(lists))
    return true
  }
  const firstNum = kid(root, 'num')
  for (const abstract of kids(generated, 'abstractNum')) {
    insertBefore(root, adopt(owner, abstract), firstNum)
  }
  for (const num of kids(generated, 'num')) root.appendChild(adopt(owner, num))
  writePart(files, path, root)
  return false
}

/** Adds Lawha's definitions of styles new content names that the package's styles lack. */
export function mergeStyles(files: MutableFiles, path: string, xml: string): void {
  const used = new Set(
    [...xml.matchAll(/<w:(?:pStyle|rStyle|tblStyle) w:val="([^"]+)"/g)].map((match) => match[1])
  )
  if (!used.size) return
  const root = readPart(files, path)
  const ours = parseXML(stylesXML())
  const owner = root ? ownerOf(root) : null
  if (!root || !ours || !owner) return
  const have = new Set(kids(root, 'style').map((style) => attrOf(style, 'styleId')))
  let changed = false
  for (const style of kids(ours, 'style')) {
    const id = attrOf(style, 'styleId')
    if (!id || have.has(id) || !used.has(id)) continue
    root.appendChild(adopt(owner, style))
    changed = true
  }
  if (changed) writePart(files, path, root)
}

/** Settings that follow `w:trackRevisions` in the schema, before which it is inserted. */
const AFTER_TRACK_REVISIONS = new Set([
  'doNotTrackMoves',
  'doNotTrackFormatting',
  'documentProtection',
  'autoFormatOverride',
  'styleLockTheme',
  'styleLockQFSet',
  'defaultTabStop'
])

export function setTrackRevisions(files: MutableFiles, path: string, on: boolean): void {
  const root = readPart(files, path)
  const owner = root ? ownerOf(root) : null
  if (!root || !owner) return
  const existing = kid(root, 'trackRevisions')
  if (on === (existing !== null)) return
  if (existing) root.removeChild(existing)
  else {
    const before = kids(root).find((child) => AFTER_TRACK_REVISIONS.has(child.localName ?? ''))
    insertBefore(root, owner.createElementNS(NS.w, 'w:trackRevisions'), before ?? null)
  }
  writePart(files, path, root)
}

export function setTitle(files: MutableFiles, title: string): void {
  const root = readPart(files, 'docProps/core.xml')
  const owner = root ? ownerOf(root) : null
  if (!root || !owner) return
  let element: Element | null = kid(root, 'title')
  if ((element?.textContent ?? '') === title) return
  if (!element) {
    element = owner.createElementNS('http://purl.org/dc/elements/1.1/', 'dc:title')
    root.appendChild(element)
  }
  element.textContent = title
  writePart(files, 'docProps/core.xml', root)
}
