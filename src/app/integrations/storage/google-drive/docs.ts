import * as v from 'valibot'

import {
  googleDocsRequests,
  googleDocumentSchema,
  type GoogleDocument,
  type WriterDocument
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

  /**
   * Writes the model over the Doc's body. `revisionId` is the revision it was opened at; Docs
   * refuses the update when the Doc changed since. Returns the revision the save made.
   */
  async function save(
    documentId: string,
    model: WriterDocument,
    revisionId: string | null,
    interactive: boolean
  ): Promise<string | null> {
    const current = await get(documentId, interactive)
    const requests = googleDocsRequests(model, current)
    const writeControl = { requiredRevisionId: revisionId ?? current.revisionId }
    const body = await request(
      `${DOCS_API}/${encodeURIComponent(documentId)}:batchUpdate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests, writeControl })
      },
      interactive
    )
    const reply = v.safeParse(
      v.object({
        writeControl: v.optional(v.object({ requiredRevisionId: v.optional(v.string()) }))
      }),
      body
    )
    return reply.success ? (reply.output.writeControl?.requiredRevisionId ?? null) : null
  }

  return { get, save }
}

export type GoogleDocsClient = ReturnType<typeof createGoogleDocsClient>
