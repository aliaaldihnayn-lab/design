import type { Element } from '@xmldom/xmldom'
import { strToU8, zipSync } from 'fflate'

import { resolvePath } from '#core/writer/docx/context'
import { PackageWriter, textWidthOf } from '#core/writer/docx/package'
import {
  commentsExtendedXML,
  commentsXML,
  corePropertiesXML,
  regionContentType,
  watermarkXML
} from '#core/writer/docx/parts'
import { newInlineState, openDocx, readDocx, readSourcedBlocks } from '#core/writer/docx/read'
import { footnoteXML, PartWriter } from '#core/writer/docx/write'
import { attrOf, DOCUMENT_NAMESPACES, kid, kids, NS, parseXML, REL } from '#core/writer/docx/xml'
import type { WriterDocument, WriterNode } from '#core/writer/model'

import { chunksOf, patchBody, setSectionPage } from './body'
import { canonical, sameNode } from './canonical'
import { importMarkup, insertBefore, ownerOf, readPart, writePart, type MutableFiles } from './dom'
import {
  declareContentTypes,
  mergeNumbering,
  mergeStyles,
  numberingBases,
  readRelationships,
  setTitle,
  setTrackRevisions,
  writeRelationships
} from './parts'

/**
 * Saves a document back into the Word package it was opened from, changing only what was
 * edited (`./body.ts` for the body). Every part the model does not edit (theme, styles,
 * numbering, settings, fonts, custom XML, other sections' headers) is kept byte for byte, and
 * the parts it does edit are patched in place.
 */

const CONTENT_TYPE = {
  numbering: 'application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml',
  comments: 'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml',
  commentsExtended:
    'application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtended+xml',
  footnotes: 'application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml',
  header: 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml',
  footer: 'application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml',
  core: 'application/vnd.openxmlformats-package.core-properties+xml'
} as const

interface PatchState {
  files: MutableFiles
  pkg: PackageWriter
  documentPath: string
  documentRels: PartWriter
  overrides: Array<{ path: string; type: string }>
  /** Markup written anew, whose styles the package may lack. */
  generated: string[]
}

const baseOf = (path: string) => path.slice(0, path.lastIndexOf('/'))

/** The part a relationship of the main part points to, by type. */
function relatedPath(state: PatchState, type: string): string | null {
  const rel = state.documentRels.rels.find((entry) => entry.type === type)
  return rel ? resolvePath(baseOf(state.documentPath), rel.target) : null
}

/** A new header or footer part, referenced first in the section. */
function addRegionPart(state: PatchState, sectPr: Element, kind: 'header' | 'footer'): string {
  const name = state.pkg.regionName(kind)
  const id = state.documentRels.rel(kind === 'header' ? REL.header : REL.footer, name)
  const element = ownerOf(sectPr).createElementNS(NS.w, `w:${kind}Reference`)
  element.setAttributeNS(NS.w, 'w:type', 'default')
  element.setAttributeNS(NS.r, 'r:id', id)
  insertBefore(sectPr, element, sectPr.firstChild)
  state.overrides.push({ path: `word/${name}`, type: CONTENT_TYPE[kind] })
  return `word/${name}`
}

/** Rewrites a header or footer part's content, adds the part, or drops the reference. */
function patchRegion(
  state: PatchState,
  sectPr: Element,
  kind: 'header' | 'footer',
  node: WriterNode | null,
  watermark: string
): void {
  const references = kids(sectPr, `${kind}Reference`)
  const reference = references.find((ref) => attrOf(ref, 'type') === 'default') ?? references.at(0)
  if (!node?.content?.length && !watermark) {
    if (reference) sectPr.removeChild(reference)
    return
  }
  const rid = attrOf(reference, 'id')
  const rel = state.documentRels.rels.find((entry) => entry.id === rid)
  const path = rel
    ? resolvePath(baseOf(state.documentPath), rel.target)
    : addRegionPart(state, sectPr, kind)
  const existingRels = readRelationships(state.files, path)
  const part = new PartWriter(state.pkg, existingRels)
  const xml = part.blocks(node?.content, textWidthOf(state.pkg.model)) || '<w:p/>'
  state.generated.push(xml)
  const tag = kind === 'header' ? 'w:hdr' : 'w:ftr'
  const root = readPart(state.files, path) ?? parseXML(`<${tag} ${DOCUMENT_NAMESPACES}/>`)
  if (!root) return
  for (const child of kids(root)) root.removeChild(child)
  for (const element of importMarkup(root, watermark + xml)) root.appendChild(element)
  writePart(state.files, path, root)
  writeRelationships(state.files, path, existingRels, part.rels)
}

const FOOTNOTE_SEPARATORS =
  '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>' +
  '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>'

/** Keeps unchanged notes as read, writes edited and new ones, drops deleted ones. */
function patchFootnotes(state: PatchState, original: WriterDocument, model: WriterDocument): void {
  if (canonical(original.footnotes) === canonical(model.footnotes)) return
  let path = relatedPath(state, REL.footnotes)
  if (!path) {
    path = 'word/footnotes.xml'
    state.documentRels.rel(REL.footnotes, 'footnotes.xml')
    state.overrides.push({ path, type: CONTENT_TYPE.footnotes })
  }
  const existingRels = readRelationships(state.files, path)
  const part = new PartWriter(state.pkg, existingRels)
  const root =
    readPart(state.files, path) ??
    parseXML(`<w:footnotes ${DOCUMENT_NAMESPACES}>${FOOTNOTE_SEPARATORS}</w:footnotes>`)
  if (!root) return
  const readById = new Map(original.footnotes.map((note) => [note.id, note]))
  const elementById = new Map(
    kids(root, 'footnote')
      .filter((note) => (attrOf(note, 'type') ?? 'normal') === 'normal')
      .map((note) => [`fn${attrOf(note, 'id') ?? ''}`, note])
  )
  for (const element of elementById.values()) root.removeChild(element)
  for (const note of model.footnotes) {
    const read = readById.get(note.id)
    const element = elementById.get(note.id)
    if (read && element && canonical(read.content) === canonical(note.content)) {
      root.appendChild(element)
      continue
    }
    const xml = footnoteXML(part, note)
    state.generated.push(xml)
    for (const created of importMarkup(root, xml)) root.appendChild(created)
  }
  writePart(state.files, path, root)
  writeRelationships(state.files, path, existingRels, part.rels)
}

/** Comments hold plain text in the model, so changed comments rewrite their parts whole. */
function patchComments(state: PatchState, original: WriterDocument, model: WriterDocument): void {
  if (canonical(original.comments) === canonical(model.comments)) return
  const number = (id: string) => state.pkg.commentNumber(id)
  const parts = [
    {
      type: REL.comments,
      name: 'comments.xml',
      contentType: CONTENT_TYPE.comments,
      xml: commentsXML(model.comments, number)
    },
    {
      type: REL.commentsExtended,
      name: 'commentsExtended.xml',
      contentType: CONTENT_TYPE.commentsExtended,
      xml: commentsExtendedXML(model.comments, number)
    }
  ]
  for (const { type, name, contentType, xml } of parts) {
    let path = relatedPath(state, type)
    if (!path) {
      path = `word/${name}`
      state.documentRels.rel(type, name)
      state.overrides.push({ path, type: contentType })
    }
    state.files[path] = strToU8(xml)
  }
}

/** The last section: its page, and its header and footer. */
function patchLastSection(
  state: PatchState,
  body: Element,
  original: WriterDocument,
  model: WriterDocument
): void {
  let sectPr = kid(body, 'sectPr')
  if (!sectPr) {
    sectPr = importMarkup(body, '<w:sectPr/>').at(0) ?? null
    if (!sectPr) return
    body.appendChild(sectPr)
  }
  if (canonical(original.page) !== canonical(model.page)) setSectionPage(sectPr, model.page)
  const watermarkChanged = canonical(original.watermark) !== canonical(model.watermark)
  if (!sameNode(original.header, model.header) || watermarkChanged) {
    const watermark = model.watermark
      ? watermarkXML(model.watermark.text, model.watermark.color)
      : ''
    patchRegion(state, sectPr, 'header', model.header, watermark)
  }
  if (!sameNode(original.footer, model.footer)) {
    patchRegion(state, sectPr, 'footer', model.footer, '')
  }
}

/** Numbering, styles, settings and properties the new content and edits need. */
function patchSharedParts(
  state: PatchState,
  numberingPath: string,
  original: WriterDocument,
  model: WriterDocument,
  creator: string
): void {
  const { files, pkg } = state
  if (mergeNumbering(files, numberingPath, pkg.lists)) {
    state.documentRels.rel(REL.numbering, numberingPath.slice(numberingPath.lastIndexOf('/') + 1))
    state.overrides.push({ path: numberingPath, type: CONTENT_TYPE.numbering })
  }
  const stylesPath = relatedPath(state, REL.styles)
  if (stylesPath) mergeStyles(files, stylesPath, state.generated.join(''))
  const settingsPath = relatedPath(state, REL.settings)
  if (settingsPath && original.trackChanges !== model.trackChanges) {
    setTrackRevisions(files, settingsPath, model.trackChanges)
  }
  if (original.title === model.title) return
  if ('docProps/core.xml' in files) setTitle(files, model.title)
  else {
    files['docProps/core.xml'] = strToU8(corePropertiesXML(model.title, creator))
    state.overrides.push({ path: 'docProps/core.xml', type: CONTENT_TYPE.core })
  }
}

export interface PatchDocxOptions {
  creator?: string
}

/** The package `source` with the model's edits applied; throws `DocxReadError` on no package. */
export function patchDocx(
  source: Uint8Array,
  model: WriterDocument,
  options: PatchDocxOptions = {}
): Uint8Array {
  const opened = openDocx(source)
  const original = readDocx(source)
  const files: MutableFiles = {}
  for (const [path, bytes] of Object.entries(opened.files)) if (bytes) files[path] = bytes
  const numberingPath =
    [...opened.context.rels.values()]
      .filter((rel) => rel.type === REL.numbering)
      .map((rel) => resolvePath(opened.context.base, rel.target))
      .at(0) ?? 'word/numbering.xml'
  const pkg = new PackageWriter(model, {
    ...numberingBases(files, numberingPath),
    mediaPrefix: 'lawha-image',
    keepNumbers: true,
    existingParts: new Set(Object.keys(files))
  })
  const documentRelsBefore = readRelationships(files, opened.documentPath)
  const state: PatchState = {
    files,
    pkg,
    documentPath: opened.documentPath,
    documentRels: new PartWriter(pkg, documentRelsBefore),
    overrides: [],
    generated: []
  }

  const chunks = chunksOf(readSourcedBlocks(opened.body, newInlineState(opened.context)))
  const blocks = model.body.content ?? []
  state.generated.push(
    patchBody(opened.body, chunks, blocks, state.documentRels, textWidthOf(model))
  )
  patchLastSection(state, opened.body, original, model)
  writePart(files, opened.documentPath, opened.root)
  patchFootnotes(state, original, model)
  patchComments(state, original, model)
  patchSharedParts(state, numberingPath, original, model, options.creator ?? 'Lawha')

  Object.assign(files, pkg.files)
  for (const path of Object.keys(pkg.files)) {
    const type = regionContentType(path)
    if (type) state.overrides.push({ path, type })
  }
  writeRelationships(files, opened.documentPath, documentRelsBefore, state.documentRels.rels)
  const media = Object.keys(pkg.files).filter((path) => path.includes('/media/'))
  declareContentTypes(
    files,
    state.overrides,
    media.map((path) => path.split('.').pop() ?? '')
  )
  return zipSync(files, { level: 6 })
}
