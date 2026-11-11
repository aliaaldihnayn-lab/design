import type { StoredKind } from '@/components/home/document/kinds'

import type { HomeLocationView } from '@/app/home/locations'

/** A place the home tab lists documents from. */
export type HomeLocation = HomeLocationView

export type HomeCloudAccount = {
  id: string
  name: string
  email: string
  image?: string | null
  /** The Cloud server's host, such as `cloud.lawha.invalid`. */
  host: string
}

/** Where a Cloud document stands between this device and the server. */
export type CloudSyncState = 'synced' | 'uploading' | 'pending' | 'offline' | 'conflict' | 'error'

export type CloudDocumentRow = {
  id: string
  name: string
  /** A design or a board, when Cloud says which. */
  kind?: StoredKind
  previewURL?: string | null
  editedAt: string
  editedBy?: string
  sync: CloudSyncState
  /** Shared beyond the workspace, with people or a link. */
  shared?: boolean
  permission: 'edit' | 'view'
}
