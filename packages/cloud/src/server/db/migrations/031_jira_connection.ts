import { CURRENT_TIMESTAMP } from '#cloud/server/db/expressions'
import type { Kysely } from 'kysely'

/**
 * The Jira Cloud site each person connected for their user stories: the site and email in the
 * clear, the API token encrypted with a key derived from the server's secret, so neither the
 * database nor a backup alone reveals it.
 */
export async function up(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .createTable('jira_connection')
    // Better Auth's tables may come after this migration, so the user is not a foreign key.
    .addColumn('user_id', 'uuid', (column) => column.primaryKey())
    .addColumn('site', 'text', (column) => column.notNull())
    .addColumn('email', 'text', (column) => column.notNull())
    .addColumn('api_token_encrypted', 'text', (column) => column.notNull())
    .addColumn('created_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(CURRENT_TIMESTAMP)
    )
    .addColumn('updated_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(CURRENT_TIMESTAMP)
    )
    .execute()
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await database.schema.dropTable('jira_connection').ifExists().execute()
}
