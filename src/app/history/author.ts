import type { HistoryAuthor } from '@lawha/core/history'

import { useCollabIdentity } from '@/app/collab/identity'

/**
 * Who this device's edits are signed with: the name this person uses in rooms. Cloud documents
 * sign them with the signed-in account instead, on the server.
 */
export function localHistoryAuthor(): HistoryAuthor {
  const name = useCollabIdentity().name.value
  return { id: `local:${name}`, name, avatarUrl: null, color: null }
}
