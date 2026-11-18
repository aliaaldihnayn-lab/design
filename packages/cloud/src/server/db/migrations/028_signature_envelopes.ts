import type { Kysely } from 'kysely'

import { addCheckConstraint, replaceCheckConstraint, withCreatedAt } from './helpers'

const emailKinds = [
  'document-invitation',
  'workspace-invitation',
  'enrollment-requested',
  'admin-enrollment-notification',
  'enrollment-approved',
  'enrollment-rejected',
  'enrollment-revoked',
  'email-verification',
  'password-reset',
  'password-changed',
  'email-change-requested',
  'new-sign-in',
  'two-step-changed'
]

/**
 * Documents sent for signature: the PDF as sent and, once everyone has signed, the final PDF;
 * each signer with the digest of their link's secret and their signature; and an append-only
 * audit trail of who did what, when, and from where.
 */
export async function up(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .createTable('signature_envelope')
    .addColumn('id', 'uuid', (column) => column.primaryKey())
    // Better Auth's tables may come after this migration, so the sender is not a foreign key.
    .addColumn('owner_id', 'uuid', (column) => column.notNull())
    .addColumn('sender_name', 'text', (column) => column.notNull())
    .addColumn('sender_email', 'text', (column) => column.notNull())
    .addColumn('title', 'text', (column) => column.notNull())
    .addColumn('message', 'text', (column) => column.notNull().defaultTo(''))
    .addColumn('status', 'text', (column) => column.notNull())
    .addColumn('original_pdf', 'bytea', (column) => column.notNull())
    .addColumn('original_sha256', 'text', (column) => column.notNull())
    .addColumn('final_pdf', 'bytea')
    .addColumn('final_sha256', 'text')
    .$call(withCreatedAt)
    .addColumn('completed_at', 'timestamptz')
    .execute()
  await addCheckConstraint(
    database,
    'signature_envelope',
    'signature_envelope_status_check',
    'status',
    ['sent', 'completed', 'declined', 'voided']
  )
  await database.schema
    .createIndex('signature_envelope_owner_index')
    .on('signature_envelope')
    .columns(['owner_id', 'created_at'])
    .execute()
  await database.schema
    .createTable('signature_signer')
    .addColumn('id', 'uuid', (column) => column.primaryKey())
    .addColumn('envelope_id', 'uuid', (column) =>
      column.notNull().references('signature_envelope.id').onDelete('cascade')
    )
    .addColumn('position', 'integer', (column) => column.notNull())
    .addColumn('name', 'text', (column) => column.notNull())
    .addColumn('email', 'text', (column) => column.notNull())
    .addColumn('secret_digest', 'text', (column) => column.notNull().unique())
    .addColumn('status', 'text', (column) => column.notNull())
    .addColumn('signature_png', 'bytea')
    .addColumn('decline_reason', 'text')
    .addColumn('viewed_at', 'timestamptz')
    .addColumn('signed_at', 'timestamptz')
    .addColumn('declined_at', 'timestamptz')
    .execute()
  await addCheckConstraint(
    database,
    'signature_signer',
    'signature_signer_status_check',
    'status',
    ['pending', 'viewed', 'signed', 'declined']
  )
  await database.schema
    .createIndex('signature_signer_envelope_index')
    .on('signature_signer')
    .columns(['envelope_id', 'position'])
    .execute()
  await database.schema
    .createTable('signature_event')
    .addColumn('id', 'uuid', (column) => column.primaryKey())
    .addColumn('envelope_id', 'uuid', (column) =>
      column.notNull().references('signature_envelope.id').onDelete('cascade')
    )
    .addColumn('signer_id', 'uuid')
    .addColumn('kind', 'text', (column) => column.notNull())
    .addColumn('ip_address', 'text')
    .addColumn('user_agent', 'text')
    .$call(withCreatedAt)
    .execute()
  await database.schema
    .createIndex('signature_event_envelope_index')
    .on('signature_event')
    .columns(['envelope_id', 'created_at'])
    .execute()
  await replaceCheckConstraint(
    database,
    'transactional_email',
    'transactional_email_kind_check',
    'kind',
    [...emailKinds, 'signature-request', 'signature-completed']
  )
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await replaceCheckConstraint(
    database,
    'transactional_email',
    'transactional_email_kind_check',
    'kind',
    emailKinds
  )
  await database.schema.dropTable('signature_event').execute()
  await database.schema.dropTable('signature_signer').execute()
  await database.schema.dropTable('signature_envelope').execute()
}
