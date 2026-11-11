import type { WriterDocument, WriterNode } from '../model'
import type { GoogleDocument, GoogleDocsRequest, GoogleStructuralElement } from './types'
import { type GoogleDocsWriteOptions, regionChunkRequests } from './write'

/**
 * Headers, footers and comments for a Docs save. These live outside `documents.batchUpdate`'s
 * body edit:
 *
 * - A header or footer is a segment of its own. A Doc without one gets it from `createHeader`
 *   or `createFooter`, whose reply carries the new segment's id, so filling it is a second
 *   batch. https://developers.google.com/docs/api/how-tos/headers-footers
 * - Docs has no request that inserts an auto text (page number or count) field, so a region
 *   with one is left as the Doc has it and reported. https://developers.google.com/docs/api/reference/rest/v1/documents/request
 * - Comments belong to Drive, not Docs: `comments.create` with the quoted text. Drive cannot
 *   anchor one to a range of a Doc, so they show as unanchored comments quoting their text.
 *   https://developers.google.com/drive/api/guides/manage-comments
 * - Suggestions cannot be created through either API; Docs only reads them.
 */

export type GoogleRegionKind = 'header' | 'footer'

/** Why part of a document could not be saved to Docs. */
export type GoogleDocsSkipped =
  | { kind: 'pageField'; region: GoogleRegionKind }
  | { kind: 'image'; count: number }
  | { kind: 'suggestions' }

export interface GoogleRegionPlan {
  /** Requests for regions the Doc lacks; their replies name the new segments. */
  create: GoogleDocsRequest[]
  /** The second batch, once every region has an id. */
  fill: (ids: Partial<Record<GoogleRegionKind, string>>) => GoogleDocsRequest[]
  skipped: GoogleDocsSkipped[]
}

function nodeText(node: WriterNode): string {
  if (node.type === 'text') return node.text ?? ''
  return (node.content ?? []).map(nodeText).join('')
}

function hasPageField(node: WriterNode): boolean {
  if (node.type === 'pageNumber' || node.type === 'pageCount') return true
  return (node.content ?? []).some(hasPageField)
}

function segmentText(content: GoogleStructuralElement[] | undefined): string {
  let text = ''
  for (const element of content ?? []) {
    for (const piece of element.paragraph?.elements ?? []) text += piece.textRun?.content ?? ''
    if (element.paragraph) text = text.replace(/\n$/, '') + '\n'
  }
  return text.replace(/\n$/, '')
}

function regionLines(node: WriterNode | null): string {
  return (node?.content ?? []).map(nodeText).join('\n')
}

function segmentEnd(content: GoogleStructuralElement[] | undefined): number {
  return content?.at(-1)?.endIndex ?? 1
}

/** The header and footer requests that bring the Doc's regions in line with the model's. */
export function googleRegionRequests(
  model: WriterDocument,
  current: GoogleDocument,
  options: GoogleDocsWriteOptions = {}
): GoogleRegionPlan {
  const create: GoogleDocsRequest[] = []
  const skipped: GoogleDocsSkipped[] = []
  const fills: ((ids: Partial<Record<GoogleRegionKind, string>>) => GoogleDocsRequest[])[] = []
  for (const kind of ['header', 'footer'] as const) {
    const region = model[kind]
    const existingId =
      kind === 'header'
        ? current.documentStyle?.defaultHeaderId
        : current.documentStyle?.defaultFooterId
    const segments = kind === 'header' ? current.headers : current.footers
    const segment = existingId ? segments?.[existingId] : undefined
    const wanted = regionLines(region)
    if (wanted === segmentText(segment?.content) && !region?.content?.some(hasPageField)) continue
    if (region && hasPageField(region)) {
      skipped.push({ kind: 'pageField', region: kind })
      continue
    }
    if (!existingId && !wanted) continue
    if (!existingId) {
      create.push(
        kind === 'header'
          ? { createHeader: { type: 'DEFAULT', sectionBreakLocation: { index: 0 } } }
          : { createFooter: { type: 'DEFAULT', sectionBreakLocation: { index: 0 } } }
      )
    }
    const end = segmentEnd(segment?.content)
    fills.push((ids) => {
      const segmentId = existingId ?? ids[kind]
      if (!segmentId) return []
      const requests: GoogleDocsRequest[] = []
      // A segment always keeps its final newline, which cannot be deleted.
      if (existingId && end - 1 > 0) {
        requests.push({
          deleteContentRange: { range: { startIndex: 0, endIndex: end - 1, segmentId } }
        })
      }
      requests.push(...regionChunkRequests(region?.content ?? [], segmentId, options))
      return requests
    })
  }
  return { create, fill: (ids) => fills.flatMap((fill) => fill(ids)), skipped }
}

/** The new segment ids in a `createHeader` / `createFooter` batch reply, in request order. */
export function createdRegionIds(
  create: GoogleDocsRequest[],
  replies: readonly unknown[]
): Partial<Record<GoogleRegionKind, string>> {
  const ids: Partial<Record<GoogleRegionKind, string>> = {}
  create.forEach((request, index) => {
    const reply = replies.at(index)
    if (!reply || typeof reply !== 'object') return
    if ('createHeader' in request && 'createHeader' in reply) {
      const id = (reply.createHeader as { headerId?: unknown } | null)?.headerId
      if (typeof id === 'string') ids.header = id
    }
    if ('createFooter' in request && 'createFooter' in reply) {
      const id = (reply.createFooter as { footerId?: unknown } | null)?.footerId
      if (typeof id === 'string') ids.footer = id
    }
  })
  return ids
}

/** A comment to post with Drive's `comments.create`. */
export interface GoogleDriveComment {
  /** The editor's id, to tell which were already posted. */
  id: string
  content: string
  quotedFileContent?: { mimeType: 'text/plain'; value: string }
  resolved: boolean
}

function collectQuotes(node: WriterNode, quotes: Map<string, string>) {
  if (node.type === 'text') {
    for (const mark of node.marks ?? []) {
      const id = mark.type === 'comment' ? mark.attrs?.commentId : null
      if (typeof id === 'string') quotes.set(id, (quotes.get(id) ?? '') + (node.text ?? ''))
    }
  }
  for (const child of node.content ?? []) collectQuotes(child, quotes)
}

/** The model's comments as Drive comments, each quoting the text it was made on. */
export function googleDriveComments(model: WriterDocument): GoogleDriveComment[] {
  const quotes = new Map<string, string>()
  collectQuotes(model.body, quotes)
  return model.comments.map((comment) => {
    const quote = quotes.get(comment.id)
    return {
      id: comment.id,
      content: comment.text,
      quotedFileContent: quote ? { mimeType: 'text/plain', value: quote } : undefined,
      resolved: comment.resolved ?? false
    }
  })
}
