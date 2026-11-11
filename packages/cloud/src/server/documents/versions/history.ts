import type { CloudDatabase } from '#cloud/server/db'
import { canEditDocument, resolveDocumentAccess } from '#cloud/server/documents/access'
import { DocumentForbiddenError, DocumentNotFoundError } from '#cloud/server/documents/errors'
import { getDocumentSummaryRow } from '#cloud/server/documents/summary'
import { CLOUD_FEATURE_KEYS, type CloudPolicyContext } from '#cloud/server/policy/keys'
import type { CloudPolicy } from '#cloud/server/policy/policy'
import type { Kysely } from 'kysely'

/** How far back a workspace without full revision history keeps its versions. */
export const LIMITED_HISTORY_DAYS = 30

/**
 * The oldest moment a workspace's history reaches, or null when it keeps everything: with the
 * `revisionHistory` entitlement off, only the last 30 days, as on a free plan.
 */
export async function historyStart(
  policy: CloudPolicy | undefined,
  deploymentMode: CloudPolicyContext['deploymentMode'],
  workspaceId: string,
  now: Date
): Promise<Date | null> {
  const full = policy
    ? await policy.boolean(CLOUD_FEATURE_KEYS.revisionHistory, true, {
        targetingKey: workspaceId,
        workspaceId,
        deploymentMode
      })
    : true
  return full ? null : new Date(now.getTime() - LIMITED_HISTORY_DAYS * 24 * 60 * 60_000)
}

/** The document whose history the person reads, or edits when `edit` is set. */
export async function historyDocument(
  database: Kysely<CloudDatabase>,
  userId: string,
  documentId: string,
  edit: boolean
) {
  const access = await resolveDocumentAccess(database, userId, documentId)
  if (!access) throw new DocumentNotFoundError()
  if (edit && !canEditDocument(access)) throw new DocumentForbiddenError()
  const document = await getDocumentSummaryRow(database, documentId)
  if (!document) throw new DocumentNotFoundError()
  return document
}
