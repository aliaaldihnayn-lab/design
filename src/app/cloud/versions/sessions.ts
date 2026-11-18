import { groupBy } from 'es-toolkit'

import type { DocumentHistoryChange, DocumentVersion } from '@lawha/cloud/contract'

/** Edits one person made in one sitting between two versions, as the server logged them. */
export type CloudEditSession = {
  kind: 'session'
  id: string
  author: DocumentHistoryChange['author']
  /** Oldest first. */
  changes: DocumentHistoryChange[]
  /** When the last edit of the session was made, in milliseconds. */
  at: number
}

export type CloudVersionEntry = { kind: 'version'; version: DocumentVersion; at: number }
export type CloudTimelineEntry = CloudVersionEntry | CloudEditSession

const timeOf = (iso: string) => Date.parse(iso)

/**
 * A Cloud document's versions with the edits between them, newest first: each version an entry
 * of its own, and the edits of `document_history_change` grouped by editing session and author,
 * split where a version falls inside a session so every entry reads in time order. Edits older
 * than the oldest version listed wait for that page, so a session never shows above versions it
 * came before.
 */
export function cloudVersionTimeline(
  versions: readonly DocumentVersion[],
  changes: readonly DocumentHistoryChange[],
  options: { complete?: boolean } = {}
): CloudTimelineEntry[] {
  const boundaries = versions.map((version) => timeOf(version.createdAt)).sort((a, b) => a - b)
  const oldest = boundaries.at(0)
  const shown = changes.filter(
    (change) => options.complete || oldest === undefined || timeOf(change.at) >= oldest
  )
  const segmentOf = (at: number) => boundaries.filter((boundary) => boundary < at).length
  const sessions = groupBy(
    shown.toSorted((left, right) => timeOf(left.at) - timeOf(right.at)),
    (change) => `${change.sessionId}:${change.author.id}:${segmentOf(timeOf(change.at))}`
  )
  const entries: CloudTimelineEntry[] = versions.map((version) => ({
    kind: 'version',
    version,
    at: timeOf(version.createdAt)
  }))
  for (const [id, grouped] of Object.entries(sessions)) {
    const last = grouped.at(-1)
    if (!last) continue
    entries.push({
      kind: 'session',
      id,
      author: last.author,
      changes: grouped,
      at: timeOf(last.at)
    })
  }
  // A version kept right after an edit is listed above it.
  return entries.sort((left, right) => right.at - left.at || (left.kind === 'version' ? -1 : 1))
}
