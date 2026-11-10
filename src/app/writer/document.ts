import { DocxReadError, readDocx, writeDocx } from '@lawha/core/writer'

import { DOCX, pickFile, saveFileAs, saveInPlace } from './files'
import {
  loadWriterDocument,
  markWriterSaved,
  writerDocument,
  writerName,
  writerSource
} from './session'

/** What a file action did, for the view to report; errors carry a reason to show. */
export type WriterFileOutcome =
  | { status: 'done' }
  | { status: 'cancelled' }
  | { status: 'failed'; reason: 'not-docx' | 'encrypted' | 'error'; detail: string }

const stem = (name: string) => name.replace(/\.docx$/i, '')

function failure(error: unknown): WriterFileOutcome {
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
    loadWriterDocument(document, stem(name), { kind: 'file', ...target })
    return { status: 'done' }
  } catch (error) {
    return failure(error)
  }
}

export async function openWordDocument(): Promise<WriterFileOutcome> {
  try {
    const picked = await pickFile(DOCX)
    if (!picked) return { status: 'cancelled' }
    return openWordBytes(picked.bytes, picked.name, picked)
  } catch (error) {
    return failure(error)
  }
}

function currentBytes(): Uint8Array {
  return writeDocx({
    ...writerDocument.value,
    title: writerName.value || writerDocument.value.title
  })
}

/** Saves as a new file; the document then saves there. */
export async function saveWriterDocumentAs(): Promise<WriterFileOutcome> {
  try {
    const saved = await saveFileAs(currentBytes(), writerName.value || 'Document', DOCX)
    if (!saved) return { status: 'cancelled' }
    if (saved.inPlace) {
      markWriterSaved({ kind: 'file', handle: saved.handle, path: saved.path }, stem(saved.name))
    } else markWriterSaved({ kind: 'file', handle: null, path: null })
    return { status: 'done' }
  } catch (error) {
    return failure(error)
  }
}

/** Writes back to the file the document came from, or asks where when there is none. */
export async function saveWriterDocument(): Promise<WriterFileOutcome> {
  const source = writerSource.value
  if (source?.kind !== 'file' || (!source.handle && !source.path)) return saveWriterDocumentAs()
  try {
    const written = await saveInPlace(source, currentBytes())
    if (!written) return await saveWriterDocumentAs()
    markWriterSaved(source)
    return { status: 'done' }
  } catch (error) {
    return failure(error)
  }
}
