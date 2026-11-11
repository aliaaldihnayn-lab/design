import type { HistoryDocumentKind } from '@lawha/core/history'
import { setVersionHistoryHost, type VersionHistoryTarget } from '@lawha/core/tools'

type TargetResolver = () => VersionHistoryTarget | null

const resolvers = new Map<HistoryDocumentKind, TargetResolver>()
let registered = false

/**
 * Offers a kind of document's history to the AI and MCP tools (`list_versions` and the rest):
 * the design in the active tab, or the document editor's document.
 */
export function provideHistoryToTools(kind: HistoryDocumentKind, resolve: TargetResolver): void {
  resolvers.set(kind, resolve)
  if (registered) return
  registered = true
  setVersionHistoryHost({ target: (wanted) => resolvers.get(wanted)?.() ?? null })
}
