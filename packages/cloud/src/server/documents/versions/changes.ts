import {
  documentHistorySummarySchema,
  type AppendDocumentHistoryInput,
  type DocumentHistoryChange,
  type DocumentHistoryPage
} from '#cloud/contract'
import type { CloudDatabase } from '#cloud/server/db'
import { DocumentNotFoundError } from '#cloud/server/documents/errors'
import type { CloudPolicyContext } from '#cloud/server/policy/keys'
import type { CloudPolicy } from '#cloud/server/policy/policy'
import type { Kysely } from 'kysely'
import * as v from 'valibot'

import { historyDocument, historyStart } from './history'

const DEFAULT_PAGE_SIZE = 100
const MAXIMUM_PAGE_SIZE = 500

const namesSchema = documentHistorySummarySchema.entries.names

/**
 * The log of edits between a Cloud document's versions, as the editor's version history records
 * them. Editors add to it, signed as themselves; anyone who can open the document reads it, as
 * far back as the workspace keeps history.
 */
export function createDocumentChangeService(
  database: Kysely<CloudDatabase>,
  options: {
    policy?: CloudPolicy
    deploymentMode?: CloudPolicyContext['deploymentMode']
    now?: () => Date
  } = {}
) {
  const deploymentMode = options.deploymentMode ?? 'self-hosted'
  const now = options.now ?? (() => new Date())

  async function open(userId: string, documentId: string, edit: boolean) {
    const document = await historyDocument(database, userId, documentId, edit)
    return historyStart(options.policy, deploymentMode, document.workspaceId, now())
  }

  function changes() {
    return database
      .selectFrom('documentHistoryChange')
      .leftJoin('user', (join) =>
        join.on((expression) =>
          expression(
            expression.cast(expression.ref('user.id'), 'text'),
            '=',
            expression.ref('documentHistoryChange.authorId')
          )
        )
      )
      .select([
        'documentHistoryChange.id',
        'documentHistoryChange.clientId',
        'documentHistoryChange.authorId',
        'user.name as authorName',
        'documentHistoryChange.sessionId',
        'documentHistoryChange.action',
        'documentHistoryChange.changeCount',
        'documentHistoryChange.names',
        'documentHistoryChange.label',
        'documentHistoryChange.madeAt'
      ])
  }

  return {
    /** A page of the document's edits, newest first, older than `before` when given. */
    async list(
      userId: string,
      documentId: string,
      page: { before?: string; limit?: number } = {}
    ): Promise<DocumentHistoryPage> {
      const start = await open(userId, documentId, false)
      const limit = Math.min(Math.max(page.limit ?? DEFAULT_PAGE_SIZE, 1), MAXIMUM_PAGE_SIZE)
      let query = changes().where('documentHistoryChange.documentId', '=', documentId)
      if (start) query = query.where('documentHistoryChange.madeAt', '>=', start)
      if (page.before) {
        const cursor = await database
          .selectFrom('documentHistoryChange')
          .select(['id', 'madeAt'])
          .where('documentId', '=', documentId)
          .where('id', '=', page.before)
          .executeTakeFirst()
        if (!cursor) throw new DocumentNotFoundError()
        query = query.where((expression) =>
          expression.or([
            expression('documentHistoryChange.madeAt', '<', cursor.madeAt),
            expression.and([
              expression('documentHistoryChange.madeAt', '=', cursor.madeAt),
              expression('documentHistoryChange.id', '<', cursor.id)
            ])
          ])
        )
      }
      const rows = await query
        .orderBy('documentHistoryChange.madeAt', 'desc')
        .orderBy('documentHistoryChange.id', 'desc')
        .limit(limit + 1)
        .execute()
      const shown = rows.slice(0, limit)
      return {
        changes: shown.map((row): DocumentHistoryChange => ({
          id: row.clientId,
          at: row.madeAt.toISOString(),
          sessionId: row.sessionId,
          summary: v.parse(documentHistorySummarySchema, {
            action: row.action,
            count: row.changeCount,
            names: v.parse(namesSchema, row.names),
            label: row.label
          }),
          author: { id: row.authorId, name: row.authorName }
        })),
        nextCursor: rows.length > limit ? (shown.at(-1)?.id ?? null) : null
      }
    },

    /**
     * Adds edits made in the editor, signed by the person sending them. An edit already added,
     * by its id, is skipped; a time later than the server's is taken as now.
     */
    async append(
      userId: string,
      documentId: string,
      input: AppendDocumentHistoryInput
    ): Promise<{ added: number }> {
      await open(userId, documentId, true)
      const latest = now()
      const rows = input.changes.map((change) => {
        const at = new Date(change.at)
        return {
          id: crypto.randomUUID(),
          documentId,
          clientId: change.id,
          authorId: userId,
          sessionId: change.sessionId,
          action: change.summary.action,
          changeCount: change.summary.count,
          names: JSON.stringify(change.summary.names),
          label: change.summary.label,
          madeAt: at.getTime() > latest.getTime() ? latest : at
        }
      })
      const inserted = await database
        .insertInto('documentHistoryChange')
        .values(rows)
        .onConflict((conflict) => conflict.columns(['documentId', 'clientId']).doNothing())
        .returning('id')
        .execute()
      return { added: inserted.length }
    }
  }
}

export type DocumentChangeService = ReturnType<typeof createDocumentChangeService>
