import { checkColumnIn } from '#cloud/server/db/expressions'
import type { Kysely } from 'kysely'

import { addCurrentTimestampColumns } from './helpers'

const actions = [
  'create',
  'delete',
  'move',
  'resize',
  'rotate',
  'reorder',
  'rename',
  'edit-text',
  'restyle',
  'edit',
  'undo',
  'redo',
  'restore'
]

/**
 * Each edit made to a Cloud document, as the editor's version history records it: who made it,
 * when, in which sitting, and what it did to which layers or paragraphs. Versions stay in
 * `document_version`; this is the log between them.
 */
export async function up(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .createTable('document_history_change')
    .addColumn('id', 'uuid', (column) => column.primaryKey())
    .addColumn('document_id', 'uuid', (column) =>
      column.references('document.id').onDelete('cascade').notNull()
    )
    // The editor's own id for the edit, so a batch sent twice adds nothing the second time.
    .addColumn('client_id', 'text', (column) => column.notNull())
    // Better Auth's tables may come after other migrations, so the author is not a foreign key.
    .addColumn('author_id', 'text', (column) => column.notNull())
    .addColumn('session_id', 'text', (column) => column.notNull())
    .addColumn('action', 'text', (column) => column.notNull())
    .addColumn('change_count', 'integer', (column) => column.notNull())
    .addColumn('names', 'jsonb', (column) => column.notNull())
    .addColumn('label', 'text', (column) => column.notNull())
    .addColumn('made_at', 'timestamptz', (column) => column.notNull())
    .addUniqueConstraint('document_history_change_client_unique', ['document_id', 'client_id'])
    .addCheckConstraint('document_history_change_action_check', checkColumnIn('action', actions))
    .execute()
  await addCurrentTimestampColumns(database, 'document_history_change', ['created_at'])
  await database.schema
    .createIndex('document_history_change_document_index')
    .on('document_history_change')
    .columns(['document_id', 'made_at desc', 'id desc'])
    .execute()
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await database.schema.dropTable('document_history_change').execute()
}
