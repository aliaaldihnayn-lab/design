import * as v from 'valibot'

import {
  createdRegionIds,
  googleDocsRequests,
  googleDriveComments,
  googleRegionRequests,
  type GoogleDocsRequest,
  type GoogleDocsSkipped,
  googleDocumentSchema,
  type GoogleDocument,
  type WriterDocument,
  type WriterNode
} from '@lawha/core/writer'

import { storageErrorText } from '../errors'
import { readStoragePreferences } from '../preferences'
import { DEFAULT_DRIVE_CLIENT_ID, DRIVE_CLIENT_ID_FIELD } from './adapter'
import { driveAccessToken, forgetDriveToken, GOOGLE_DOCS_SCOPE } from './auth'

/**
 * Google Docs for the document editor: a Doc is read with `documents.get` and saved back to the
 * same Doc with `documents.batchUpdate`, through the Drive integration's Google sign-in with
 * the `documents` scope added. A save names the revision it started from, so a change made in
 * Docs in the meantime is reported instead of overwritten.
 */
const DOCS_API = 'https://docs.googleapis.com/v1/documents'
const DRIVE_FILES_API = 'https://www.googleapis.com/drive/v3/files'

/**
 * Images Docs can fetch itself. An image the editor holds as a data URL would have to be made
 * public on Drive first, which a save must not do behind the user's back, so it is skipped.
 */
function fetchableImageURI(src: string): string | null {
  return src.startsWith('https://') ? src : null
}

const batchReplySchema = v.object({
  replies: v.optional(v.array(v.unknown())),
  writeControl: v.optional(v.object({ requiredRevisionId: v.optional(v.string()) }))
})

const commentListSchema = v.object({
  comments: v.optional(
    v.array(
      v.object({
        content: v.optional(v.string()),
        quotedFileContent: v.optional(v.object({ value: v.optional(v.string()) }))
      })
    )
  )
})

const createdCommentSchema = v.object({ id: v.string() })

/** What a save wrote, and what Google's APIs gave no way to write. */
export interface GoogleDocsSaveResult {
  revisionId: string | null
  skipped: GoogleDocsSkipped[]
  commentsPosted: number
}

/** The Doc id in a Docs link (`/document/d/<id>/edit`), or the id itself. */
export function parseGoogleDocId(input: string): string | null {
  const trimmed = input.trim()
  const fromLink = /\/document\/(?:u\/\d+\/)?d\/([\w-]{20,})/.exec(trimmed)
  if (fromLink) return fromLink[1]
  return /^[\w-]{20,}$/.test(trimmed) ? trimmed : null
}

export class GoogleDocsError extends Error {
  override name = 'GoogleDocsError'

  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

/** How the client gets a token; tests pass their own instead of signing in. */
export interface GoogleDocsAuth {
  token(interactive: boolean): Promise<string>
  forget(): void
}

function clientId(): string {
  return (
    readStoragePreferences('google-drive')[DRIVE_CLIENT_ID_FIELD]?.trim() || DEFAULT_DRIVE_CLIENT_ID
  )
}

const googleSignIn: GoogleDocsAuth = {
  token: (interactive) => driveAccessToken(clientId(), interactive, GOOGLE_DOCS_SCOPE),
  forget: () => forgetDriveToken(GOOGLE_DOCS_SCOPE)
}

const errorSchema = v.object({ error: v.object({ message: v.string() }) })

/** The part of `fetch` the client uses, so tests can answer for Google. */
export type DocsFetch = (url: string, init: RequestInit) => Promise<Response>

export function createGoogleDocsClient(
  auth: GoogleDocsAuth = googleSignIn,
  fetcher: DocsFetch = (url, init) => fetch(url, init)
) {
  async function request(url: string, init: RequestInit, interactive: boolean): Promise<unknown> {
    const token = await auth.token(interactive)
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${token}`)
    const response = await fetcher(url, { ...init, headers })
    const body: unknown = await response.json().catch(() => null)
    if (response.ok) return body
    if (response.status === 401) auth.forget()
    const parsed = v.safeParse(errorSchema, body)
    throw new GoogleDocsError(
      parsed.success ? parsed.output.error.message : response.statusText,
      response.status
    )
  }

  async function get(documentId: string, interactive: boolean): Promise<GoogleDocument> {
    const body = await request(`${DOCS_API}/${encodeURIComponent(documentId)}`, {}, interactive)
    const parsed = v.safeParse(googleDocumentSchema, body)
    if (!parsed.success)
      throw new GoogleDocsError(
        storageErrorText((t) => t.googleDocsUnexpected),
        0
      )
    return parsed.output
  }

  async function batch(
    documentId: string,
    requests: GoogleDocsRequest[],
    revisionId: string | null,
    interactive: boolean
  ) {
    const body = await request(
      `${DOCS_API}/${encodeURIComponent(documentId)}:batchUpdate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests,
          writeControl: revisionId ? { requiredRevisionId: revisionId } : undefined
        })
      },
      interactive
    )
    const reply = v.safeParse(batchReplySchema, body)
    return {
      replies: reply.success ? (reply.output.replies ?? []) : [],
      revisionId: reply.success ? (reply.output.writeControl?.requiredRevisionId ?? null) : null
    }
  }

  /**
   * Drive comments the model has that the Doc does not, matched by text and quote so saving
   * twice posts nothing new. A resolved one is resolved with a reply, as Drive requires.
   * https://developers.google.com/drive/api/guides/manage-comments
   */
  async function postComments(
    documentId: string,
    model: WriterDocument,
    interactive: boolean
  ): Promise<number> {
    const wanted = googleDriveComments(model)
    if (!wanted.length) return 0
    const url = `${DRIVE_FILES_API}/${encodeURIComponent(documentId)}/comments`
    const listed = v.safeParse(
      commentListSchema,
      await request(
        `${url}?fields=comments(content,quotedFileContent)&pageSize=100`,
        {},
        interactive
      )
    )
    const existing = new Set(
      (listed.success ? (listed.output.comments ?? []) : []).map(
        (comment) => `${comment.content ?? ''}\u0000${comment.quotedFileContent?.value ?? ''}`
      )
    )
    let posted = 0
    for (const comment of wanted) {
      const key = `${comment.content}\u0000${comment.quotedFileContent?.value ?? ''}`
      if (existing.has(key)) continue
      const created = v.safeParse(
        createdCommentSchema,
        await request(
          `${url}?fields=id`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              content: comment.content,
              quotedFileContent: comment.quotedFileContent
            })
          },
          interactive
        )
      )
      posted++
      if (comment.resolved && created.success) {
        await request(
          `${url}/${encodeURIComponent(created.output.id)}/replies?fields=id`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'resolve' })
          },
          interactive
        )
      }
    }
    return posted
  }

  /**
   * Writes the model over the Doc: the body in one batch, then its header and footer (a new
   * one takes a batch to create and one to fill), then comments through Drive. `revisionId` is
   * the revision it was opened at; Docs refuses the first batch when the Doc changed since.
   */
  async function save(
    documentId: string,
    model: WriterDocument,
    revisionId: string | null,
    interactive: boolean
  ): Promise<GoogleDocsSaveResult> {
    const current = await get(documentId, interactive)
    const options = { imageURI: fetchableImageURI }
    const skippedImages = countImages(model.body) - countImages(model.body, fetchableImageURI)
    let revision = (
      await batch(
        documentId,
        googleDocsRequests(model, current, options),
        revisionId ?? current.revisionId ?? null,
        interactive
      )
    ).revisionId
    const regions = googleRegionRequests(model, current, options)
    let ids = {}
    if (regions.create.length) {
      const created = await batch(documentId, regions.create, revision, interactive)
      revision = created.revisionId ?? revision
      ids = createdRegionIds(regions.create, created.replies)
    }
    const fill = regions.fill(ids)
    if (fill.length) revision = (await batch(documentId, fill, revision, interactive)).revisionId
    const commentsPosted = await postComments(documentId, model, interactive)
    const skipped = [...regions.skipped]
    if (skippedImages) skipped.push({ kind: 'image', count: skippedImages })
    if (hasSuggestions(model.body)) skipped.push({ kind: 'suggestions' })
    return { revisionId: revision, skipped, commentsPosted }
  }

  return { get, save }
}

export type GoogleDocsClient = ReturnType<typeof createGoogleDocsClient>

function countImages(node: WriterNode, accept: (src: string) => string | null = () => ''): number {
  const src = node.type === 'image' ? node.attrs?.src : undefined
  const own = typeof src === 'string' && accept(src) !== null ? 1 : 0
  return own + (node.content ?? []).reduce((sum, child) => sum + countImages(child, accept), 0)
}

/** Tracked insertions and deletions, which Docs keeps as suggestions no API can create. */
function hasSuggestions(node: WriterNode): boolean {
  if (node.marks?.some((mark) => mark.type === 'insertion' || mark.type === 'deletion')) return true
  return (node.content ?? []).some(hasSuggestions)
}
