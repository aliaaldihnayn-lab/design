import { checkColumnIn, CURRENT_TIMESTAMP, EMPTY_JSON_OBJECT } from '#cloud/server/db/expressions'
import { sql, type Kysely } from 'kysely'

import { addCurrentTimestampColumns, addInvitationColumns, replaceCheckConstraint } from './helpers'

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
  'two-step-changed',
  'signature-request',
  'signature-completed'
]

/**
 * Rooms: places inside a workspace that hold files and nested sub-rooms, each with its own
 * members. A sub-room either inherits who may enter from its parent or keeps to its own list; a
 * top-level room always keeps to its own. A document belongs to at most one room, and while it
 * does, the room decides who reaches it instead of the workspace. Membership changes are kept in
 * an append-only audit trail, and who is in a room now is a heartbeat per person.
 */
export async function up(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .createTable('room')
    .addColumn('id', 'uuid', (column) => column.primaryKey())
    .addColumn('workspace_id', 'uuid', (column) =>
      column.notNull().references('workspace.id').onDelete('cascade')
    )
    .addColumn('parent_id', 'uuid', (column) => column.references('room.id').onDelete('cascade'))
    .addColumn('name', 'text', (column) => column.notNull())
    .addColumn('access_mode', 'text', (column) => column.notNull())
    .addColumn('created_by', 'text', (column) => column.notNull())
    .addColumn('created_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(CURRENT_TIMESTAMP)
    )
    .addColumn('updated_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(CURRENT_TIMESTAMP)
    )
    .addColumn('archived_at', 'timestamptz')
    .addCheckConstraint(
      'room_access_mode_check',
      checkColumnIn('access_mode', ['inherit', 'restricted'])
    )
    // A room with no parent has nothing to inherit from.
    .addCheckConstraint(
      'room_top_level_restricted_check',
      sql<boolean>`parent_id is not null or access_mode = 'restricted'`
    )
    .execute()
  await database.schema
    .createIndex('room_workspace_index')
    .on('room')
    .column('workspace_id')
    .execute()
  await database.schema.createIndex('room_parent_index').on('room').column('parent_id').execute()

  await database.schema
    .createTable('room_member')
    .addColumn('room_id', 'uuid', (column) =>
      column.notNull().references('room.id').onDelete('cascade')
    )
    // Account ids are text in membership rows, as in `workspace_member`.
    .addColumn('user_id', 'text', (column) => column.notNull())
    .addColumn('role', 'text', (column) => column.notNull())
    .addColumn('added_by', 'text', (column) => column.notNull())
    .addColumn('created_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(CURRENT_TIMESTAMP)
    )
    .addPrimaryKeyConstraint('room_member_primary', ['room_id', 'user_id'])
    .addCheckConstraint(
      'room_member_role_check',
      checkColumnIn('role', ['owner', 'editor', 'viewer'])
    )
    .execute()
  await database.schema
    .createIndex('room_member_user_index')
    .on('room_member')
    .column('user_id')
    .execute()
  // Every room has exactly one owner row; transferring ownership swaps it in one transaction.
  await database.schema
    .createIndex('room_member_owner_index')
    .on('room_member')
    .column('room_id')
    .unique()
    .where(sql.ref('role'), '=', 'owner')
    .execute()

  await addInvitationColumns(
    database.schema
      .createTable('room_invitation')
      .addColumn('id', 'uuid', (column) => column.primaryKey())
      .addColumn('room_id', 'uuid', (column) =>
        column.notNull().references('room.id').onDelete('cascade')
      )
      .addColumn('status', 'text', (column) => column.notNull().defaultTo('pending'))
      .addColumn('accepted_by', 'text'),
    'role'
  )
    .addCheckConstraint('room_invitation_role_check', checkColumnIn('role', ['editor', 'viewer']))
    .addCheckConstraint(
      'room_invitation_status_check',
      checkColumnIn('status', ['pending', 'accepted', 'revoked'])
    )
    .execute()
  await addCurrentTimestampColumns(database, 'room_invitation', ['invited_at'])
  await database.schema
    .createIndex('room_invitation_room_index')
    .on('room_invitation')
    .columns(['room_id', 'status'])
    .execute()

  await database.schema
    .createTable('room_file')
    .addColumn('document_id', 'uuid', (column) =>
      column.primaryKey().references('document.id').onDelete('cascade')
    )
    .addColumn('room_id', 'uuid', (column) =>
      column.notNull().references('room.id').onDelete('cascade')
    )
    .addColumn('added_by', 'text', (column) => column.notNull())
    .addColumn('added_at', 'timestamptz', (column) => column.notNull().defaultTo(CURRENT_TIMESTAMP))
    .execute()
  await database.schema
    .createIndex('room_file_room_index')
    .on('room_file')
    .column('room_id')
    .execute()

  await database.schema
    .createTable('room_audit_event')
    .addColumn('id', 'uuid', (column) => column.primaryKey())
    .addColumn('room_id', 'uuid', (column) =>
      column.notNull().references('room.id').onDelete('cascade')
    )
    .addColumn('actor_user_id', 'text', (column) => column.notNull())
    .addColumn('action', 'text', (column) => column.notNull())
    .addColumn('subject_user_id', 'text')
    .addColumn('subject_email', 'text')
    .addColumn('metadata', 'jsonb', (column) => column.notNull().defaultTo(EMPTY_JSON_OBJECT))
    .addColumn('created_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(CURRENT_TIMESTAMP)
    )
    .execute()
  await database.schema
    .createIndex('room_audit_event_room_index')
    .on('room_audit_event')
    .columns(['room_id', 'created_at'])
    .execute()

  await database.schema
    .createTable('room_presence')
    .addColumn('room_id', 'uuid', (column) =>
      column.notNull().references('room.id').onDelete('cascade')
    )
    .addColumn('user_id', 'text', (column) => column.notNull())
    .addColumn('seen_at', 'timestamptz', (column) => column.notNull().defaultTo(CURRENT_TIMESTAMP))
    .addPrimaryKeyConstraint('room_presence_primary', ['room_id', 'user_id'])
    .execute()

  await replaceCheckConstraint(
    database,
    'transactional_email',
    'transactional_email_kind_check',
    'kind',
    [...emailKinds, 'room-invitation']
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
  await database.schema.dropTable('room_presence').execute()
  await database.schema.dropTable('room_audit_event').execute()
  await database.schema.dropTable('room_file').execute()
  await database.schema.dropTable('room_invitation').execute()
  await database.schema.dropTable('room_member').execute()
  await database.schema.dropTable('room').execute()
}
