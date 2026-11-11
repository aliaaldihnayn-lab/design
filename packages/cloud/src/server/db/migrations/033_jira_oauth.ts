import type { Kysely } from 'kysely'

/**
 * Jira connected through Atlassian's OAuth 2.0 (3LO) beside the API token: a connection says
 * which it is, and an OAuth one keeps the site's cloud ID and its tokens, encrypted like the API
 * token, so `email` and the API token become optional. Authorizations under way wait in
 * `jira_oauth_state` until Atlassian sends the person back.
 */
export async function up(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .alterTable('jira_connection')
    .addColumn('auth_kind', 'text', (column) => column.notNull().defaultTo('token'))
    .execute()
  await database.schema
    .alterTable('jira_connection')
    .addColumn('cloud_id', 'text')
    .addColumn('access_token_encrypted', 'text')
    .addColumn('refresh_token_encrypted', 'text')
    .addColumn('access_token_expires_at', 'timestamptz')
    .execute()
  await database.schema
    .alterTable('jira_connection')
    .alterColumn('api_token_encrypted', (column) => column.dropNotNull())
    .execute()
  await database.schema
    .createTable('jira_oauth_state')
    .addColumn('state_digest', 'text', (column) => column.primaryKey())
    .addColumn('user_id', 'uuid', (column) => column.notNull())
    .addColumn('expires_at', 'timestamptz', (column) => column.notNull())
    .execute()
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await database.schema.dropTable('jira_oauth_state').ifExists().execute()
  await database.schema.alterTable('jira_connection').dropColumn('auth_kind').execute()
  await database.schema.alterTable('jira_connection').dropColumn('cloud_id').execute()
  await database.schema.alterTable('jira_connection').dropColumn('access_token_encrypted').execute()
  await database.schema
    .alterTable('jira_connection')
    .dropColumn('refresh_token_encrypted')
    .execute()
  await database.schema
    .alterTable('jira_connection')
    .dropColumn('access_token_expires_at')
    .execute()
}
