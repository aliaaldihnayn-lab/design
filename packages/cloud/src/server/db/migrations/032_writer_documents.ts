import { sql, type Kysely } from 'kysely'

import { replaceCheckConstraint } from './helpers'

/**
 * Documents from the document editor: Word-compatible text documents kept as `.docx` revisions,
 * which live in rooms, are shared and keep version history as designs and boards do.
 */
export async function up(database: Kysely<unknown>): Promise<void> {
  await replaceCheckConstraint(database, 'document', 'document_kind_check', 'kind', [
    'design',
    'board',
    'writer'
  ])
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await sql`delete from document where kind = 'writer'`.execute(database)
  await replaceCheckConstraint(database, 'document', 'document_kind_check', 'kind', [
    'design',
    'board'
  ])
}
