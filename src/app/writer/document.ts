import {
  decryptDocx,
  DocxPasswordError,
  DocxReadError,
  readDocx,
  readGoogleDocument,
  writeDocx,
  type GoogleDocsSkipped
} from '@lawha/core/writer'

import {
  createGoogleDocsClient,
  parseGoogleDocId,
  type GoogleDocsClient
} from '@/app/integrations/storage/google-drive/docs'
import {
  googlePickerSettings,
  pickGoogleDocument
} from '@/app/integrations/storage/google-drive/picker'

import { DOCX, pickFile, saveFileAs, saveInPlace, type PickedFile } from './files'
import {
  loadWriterDocument,
  markWriterSaved,
  writerDocument,
  writerName,
  writerSource
} from './session'
import { saveStoredWriterDocument } from './storage'

/** What a file action did, for the view to report; errors carry a reason to show. */
export type WriterFileOutcome =
  | { status: 'done'; skipped?: GoogleDocsSkipped[] }
  | { status: 'cancelled' }
  | {
      status: 'failed'
      reason:
        | 'not-docx'
        | 'encrypted'
        | 'wrong-password'
        | 'invalid-google-doc'
        | 'google'
        | 'conflict'
        | 'picker-unavailable'
        | 'error'
      detail: string
    }

let googleDocs: GoogleDocsClient | null = null
const docsClient = () => (googleDocs ??= createGoogleDocsClient())

const stem = (name: string) => name.replace(/\.docx$/i, '')

function failure(error: unknown): WriterFileOutcome {
  if (error instanceof DocxPasswordError) {
    return {
      status: 'failed',
      reason: error.reason === 'wrong-password' ? 'wrong-password' : 'error',
      detail: error.reason
    }
  }
  if (
    error instanceof DocxReadError &&
    (error.message === 'encrypted' || error.message === 'not-docx')
  ) {
    return { status: 'failed', reason: error.message, detail: error.message }
  }
  return {
    status: 'failed',
    reason: 'error',
    detail: error instanceof Error ? error.message : String(error)
  }
}

/** Reads `.docx` bytes into the editor, remembering where they came from. */
export function openWordBytes(
  bytes: Uint8Array,
  name: string,
  target: { handle: FileSystemFileHandle | null; path: string | null }
): WriterFileOutcome {
  try {
    const document = readDocx(bytes)
    loadWriterDocument(document, stem(name), { kind: 'file', ...target, package: bytes })
    return { status: 'done' }
  } catch (error) {
    return failure(error)
  }
}

/** A password-protected file waiting for its password, after an open said `encrypted`. */
let lockedFile: PickedFile | null = null

/** Opens the password-protected file the last open stopped at. Saving it writes it unprotected. */
export function unlockWordDocument(password: string): WriterFileOutcome {
  if (!lockedFile) return { status: 'cancelled' }
  try {
    const { bytes, name, ...target } = lockedFile
    const outcome = openWordBytes(decryptDocx(bytes, password), name, target)
    if (outcome.status === 'done') lockedFile = null
    return outcome
  } catch (error) {
    return failure(error)
  }
}

export async function openWordDocument(): Promise<WriterFileOutcome> {
  try {
    const picked = await pickFile(DOCX)
    if (!picked) return { status: 'cancelled' }
    const outcome = openWordBytes(picked.bytes, picked.name, picked)
    lockedFile = outcome.status === 'failed' && outcome.reason === 'encrypted' ? picked : null
    return outcome
  } catch (error) {
    return failure(error)
  }
}

/** The document as Word bytes, patched into the package it came from when there is one. */
function currentBytes(): Uint8Array {
  const source = writerSource.value
  return writeDocx(
    { ...writerDocument.value, title: writerName.value || writerDocument.value.title },
    { source: source && source.kind !== 'google' ? source.package : null }
  )
}

/** Saves as a new file; the document then saves there. */
export async function saveWriterDocumentAs(): Promise<WriterFileOutcome> {
  try {
    const bytes = currentBytes()
    const saved = await saveFileAs(bytes, writerName.value || 'Document', DOCX)
    if (!saved) return { status: 'cancelled' }
    if (saved.inPlace) {
      markWriterSaved(
        { kind: 'file', handle: saved.handle, path: saved.path, package: bytes },
        stem(saved.name)
      )
    } else markWriterSaved({ kind: 'file', handle: null, path: null, package: bytes })
    return { status: 'done' }
  } catch (error) {
    return failure(error)
  }
}

/** Writes back to the file the document came from, or asks where when there is none. */
export async function saveWriterDocument(
  client: GoogleDocsClient = docsClient()
): Promise<WriterFileOutcome> {
  const source = writerSource.value
  if (source?.kind === 'google') return saveGoogleDocument(source, client)
  if (source?.kind === 'storage') return saveStoredWriterDocument(source)
  if (source?.kind !== 'file' || (!source.handle && !source.path)) return saveWriterDocumentAs()
  try {
    const bytes = currentBytes()
    const written = await saveInPlace(source, bytes)
    if (!written) return await saveWriterDocumentAs()
    markWriterSaved({ ...source, package: bytes })
    return { status: 'done' }
  } catch (error) {
    return failure(error)
  }
}

/** Opens a Google Doc by link or id; Save then writes back to the same Doc. */
export async function openGoogleDocument(
  input: string,
  client: GoogleDocsClient = docsClient()
): Promise<WriterFileOutcome> {
  const documentId = parseGoogleDocId(input)
  if (!documentId) return { status: 'failed', reason: 'invalid-google-doc', detail: input }
  try {
    const google = await client.get(documentId, true)
    loadWriterDocument(readGoogleDocument(google), google.title ?? '', {
      kind: 'google',
      documentId,
      revisionId: google.revisionId ?? null
    })
    return { status: 'done' }
  } catch (error) {
    return {
      status: 'failed',
      reason: 'google',
      detail: error instanceof Error ? error.message : String(error)
    }
  }
}

/**
 * Opens a Doc chosen in the Google Picker. Without a Picker key in the Drive settings it fails
 * with `picker-unavailable`, and the person pastes a link instead.
 */
export async function pickAndOpenGoogleDocument(
  locale: string,
  pick: (locale: string) => Promise<string | null> = pickGoogleDocument,
  client: GoogleDocsClient = docsClient()
): Promise<WriterFileOutcome> {
  if (!googlePickerSettings()) return { status: 'failed', reason: 'picker-unavailable', detail: '' }
  try {
    const documentId = await pick(locale)
    if (!documentId) return { status: 'cancelled' }
    return await openGoogleDocument(documentId, client)
  } catch (error) {
    return {
      status: 'failed',
      reason: 'google',
      detail: error instanceof Error ? error.message : String(error)
    }
  }
}

async function saveGoogleDocument(
  source: { documentId: string; revisionId: string | null },
  client: GoogleDocsClient
): Promise<WriterFileOutcome> {
  try {
    const saved = await client.save(
      source.documentId,
      writerDocument.value,
      source.revisionId,
      true
    )
    // The next save requires the revision this one made, so edits made in Docs since are caught.
    markWriterSaved({
      kind: 'google',
      documentId: source.documentId,
      revisionId: saved.revisionId
    })
    return { status: 'done', skipped: saved.skipped }
  } catch (error) {
    return {
      status: 'failed',
      reason: 'google',
      detail: error instanceof Error ? error.message : String(error)
    }
  }
}
