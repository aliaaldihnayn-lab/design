import type { DocumentVersion } from '@lawha/cloud/contract'

import { downloadCloudDocument } from '@/app/integrations/storage/cloud/download'
import type { StorageDocumentBinding } from '@/app/integrations/storage/types'

import { cloudShareTarget } from '../sharing/document'

/**
 * A document editor file's Cloud version history: every save is a revision the server keeps as
 * a version, which the writer's history panel lists beside this device's own history and can
 * open as the Word file it was.
 */

/** The file's versions, newest first; null when the file is not on a signed-in Cloud server. */
export async function cloudWriterVersions(
  binding: StorageDocumentBinding
): Promise<DocumentVersion[] | null> {
  const target = cloudShareTarget(binding)
  if (!target) return null
  return (await target.client.listDocumentVersions(target.documentId, { limit: 50 })).versions
}

/** A version's `.docx` bytes. */
export async function cloudWriterVersionBytes(
  binding: StorageDocumentBinding,
  versionId: string
): Promise<Uint8Array> {
  const target = cloudShareTarget(binding)
  if (!target) throw new Error('The Cloud server is not signed in')
  const download = await target.client.getDocumentVersion(target.documentId, versionId)
  return downloadCloudDocument(download.document, (input, init) => fetch(input, init))
}
