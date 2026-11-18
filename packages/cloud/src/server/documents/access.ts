import type {
  DocumentAccess,
  DocumentAccessSource,
  DocumentPermission,
  WorkspaceRole
} from '#cloud/contract'
import type { CloudDatabase } from '#cloud/server/db'
import { documentRoomAccess } from '#cloud/server/rooms/access'
import { maxBy } from 'es-toolkit'
import type { Kysely, Transaction } from 'kysely'

export type AccessDatabase = Kysely<CloudDatabase> | Transaction<CloudDatabase>

const PERMISSION_WEIGHT: Record<DocumentPermission, number> = { view: 1, edit: 2 }

function workspacePermission(role: WorkspaceRole): DocumentPermission {
  return role === 'viewer' ? 'view' : 'edit'
}

export async function resolveDocumentAccess(
  database: AccessDatabase,
  userId: string,
  documentId: string
): Promise<DocumentAccess | undefined> {
  const document = await database
    .selectFrom('document')
    .leftJoin('workspaceMember', (join) =>
      join
        .onRef('workspaceMember.workspaceId', '=', 'document.workspaceId')
        .on('workspaceMember.userId', '=', userId)
    )
    .leftJoin('documentGrant', (join) =>
      join
        .onRef('documentGrant.documentId', '=', 'document.id')
        .on('documentGrant.userId', '=', userId)
        .on('documentGrant.revokedAt', 'is', null)
    )
    .select([
      'document.createdBy',
      'workspaceMember.role as workspaceRole',
      'documentGrant.permission as grantPermission'
    ])
    .where('document.id', '=', documentId)
    .where('document.deletedAt', 'is', null)
    .executeTakeFirst()
  if (!document) return undefined
  // A document kept in a room is reached through the room, not through its workspace.
  const room = await documentRoomAccess(database, userId, documentId)
  const workspaceRole = room ? null : document.workspaceRole

  const sources: DocumentAccessSource[] = []
  const candidates: DocumentPermission[] = []
  const owner = document.createdBy === userId
  if (owner) {
    sources.push('owner')
    candidates.push('edit')
  }
  if (workspaceRole) {
    sources.push('workspace')
    candidates.push(workspacePermission(workspaceRole))
  }
  if (room?.role) {
    sources.push('room')
    candidates.push(room.role === 'viewer' ? 'view' : 'edit')
  }
  if (document.grantPermission) {
    sources.push('direct-grant')
    candidates.push(document.grantPermission)
  }
  const permission = maxBy(candidates, (candidate) => PERMISSION_WEIGHT[candidate])
  if (!permission) return undefined
  const workspaceCanManage = workspaceRole === 'admin' || workspaceRole === 'editor'
  const roomCanManage = room?.role === 'owner' || room?.role === 'editor'
  return {
    permission,
    canManageSharing:
      owner || workspaceCanManage || roomCanManage || document.grantPermission === 'edit',
    sources
  }
}

export function canEditDocument(access: DocumentAccess): boolean {
  return access.permission === 'edit'
}

/**
 * Removing a document belongs to its owner and its workspace's admins and editors, or, for a
 * document kept in a room, the room's owner and editors. A direct grant or an accepted invitation
 * lets someone edit, never delete the owner's document.
 */
export async function canDeleteDocument(
  database: AccessDatabase,
  userId: string,
  documentId: string
): Promise<boolean> {
  const document = await database
    .selectFrom('document')
    .leftJoin('workspaceMember', (join) =>
      join
        .onRef('workspaceMember.workspaceId', '=', 'document.workspaceId')
        .on('workspaceMember.userId', '=', userId)
    )
    .select(['document.createdBy', 'workspaceMember.role as workspaceRole'])
    .where('document.id', '=', documentId)
    .where('document.deletedAt', 'is', null)
    .executeTakeFirst()
  if (!document) return false
  if (document.createdBy === userId) return true
  const room = await documentRoomAccess(database, userId, documentId)
  if (room) return room.role === 'owner' || room.role === 'editor'
  return document.workspaceRole === 'admin' || document.workspaceRole === 'editor'
}
