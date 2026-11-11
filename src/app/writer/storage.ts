import { readDocx, writeDocx } from '@lawha/core/writer'

import {
  createStorageAdapter,
  StorageRevisionConflictError,
  type StorageDocumentBinding
} from '@/app/integrations/storage'

import type { WriterFileOutcome } from './document'
import {
  loadWriterDocument,
  markWriterSaved,
  newWriterDocument,
  writerDocument,
  writerName,
  type WriterSource
} from './session'

/**
 * Document editor files kept by a storage provider, such as a Lawha Cloud workspace or room:
 * each save is a new revision of a Word `.docx` file, patched into the one it was opened from,
 * so the provider's version history holds every save and sharing and rooms work as for designs.
 */

type StorageSource = Extract<WriterSource, { kind: 'storage' }>

function failed(error: unknown): WriterFileOutcome {
  return {
    status: 'failed',
    reason: error instanceof StorageRevisionConflictError ? 'conflict' : 'error',
    detail: error instanceof Error ? error.message : String(error)
  }
}

/** Opens a stored document's current revision in the document editor. */
export async function openStoredWriterDocument(
  binding: StorageDocumentBinding,
  name: string
): Promise<WriterFileOutcome> {
  try {
    const content = await createStorageAdapter(binding).getDocument(binding.documentId)
    loadWriterDocument(readDocx(content.bytes), name, {
      kind: 'storage',
      binding,
      revision: content.revision ?? null,
      package: content.bytes
    })
    return { status: 'done' }
  } catch (error) {
    return failed(error)
  }
}

/** Starts an empty document bound to a stored one that has no revision yet, such as a new file. */
export function startStoredWriterDocument(binding: StorageDocumentBinding, name: string): void {
  newWriterDocument('rtl')
  writerName.value = name
  markWriterSaved({ kind: 'storage', binding, revision: null, package: null })
}

/** Saves a new revision; one made over a revision someone else saved since is refused. */
export async function saveStoredWriterDocument(source: StorageSource): Promise<WriterFileOutcome> {
  try {
    const name = writerName.value || writerDocument.value.title || 'Document'
    const bytes = writeDocx({ ...writerDocument.value, title: name }, { source: source.package })
    const result = await createStorageAdapter(source.binding).putDocument(
      source.binding.documentId,
      bytes,
      { name, updatedAt: new Date().toISOString() },
      undefined,
      { baseRevision: source.revision }
    )
    markWriterSaved({ ...source, revision: result.revision ?? null, package: bytes })
    return { status: 'done' }
  } catch (error) {
    return failed(error)
  }
}
