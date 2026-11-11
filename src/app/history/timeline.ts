import { fromAbsolute, toCalendarDate, type CalendarDate } from '@internationalized/date'
import { groupBy } from 'es-toolkit'

import type {
  DocumentHistory,
  HistoryAuthor,
  HistoryChange,
  HistoryVersion
} from '@lawha/core/history'

/** Edits made in one sitting by one person, shown together on the timeline. */
export type HistorySessionEntry = {
  kind: 'session'
  id: string
  author: HistoryAuthor
  changes: HistoryChange[]
  /** When the last edit of the session was made. */
  at: number
}

export type HistoryVersionEntry = { kind: 'version'; version: HistoryVersion; at: number }
export type HistoryTimelineEntry = HistorySessionEntry | HistoryVersionEntry

export type HistoryTimelineDay = {
  /** The calendar day, in the reader's time zone. */
  day: CalendarDate
  entries: HistoryTimelineEntry[]
}

/**
 * A history as the panel lists it, newest first: grouped by calendar day, versions as entries of
 * their own and the edits between them by session. A session a version falls inside is split at
 * the version, so every entry reads in time order.
 */
export function historyTimeline(history: DocumentHistory, timeZone: string): HistoryTimelineDay[] {
  const versions = history.listVersions()
  const entries: HistoryTimelineEntry[] = versions.map((version) => ({
    kind: 'version',
    version,
    at: version.at
  }))
  const boundaries = versions.map((version) => version.at).sort((left, right) => left - right)
  const segmentOf = (at: number) => boundaries.filter((boundary) => boundary < at).length
  const sessions = groupBy(
    history.listChanges(),
    (change) => `${change.sessionId}:${segmentOf(change.at)}`
  )
  for (const [id, changes] of Object.entries(sessions)) {
    const last = changes.at(-1)
    if (!last) continue
    entries.push({ kind: 'session', id, author: last.author, changes, at: last.at })
  }
  // A version kept right after an edit is listed above it.
  entries.sort((left, right) => right.at - left.at || (left.kind === 'version' ? -1 : 1))
  const days: HistoryTimelineDay[] = []
  for (const entry of entries) {
    const day = toCalendarDate(fromAbsolute(entry.at, timeZone))
    const current = days.at(-1)
    if (current?.day.compare(day) === 0) current.entries.push(entry)
    else days.push({ day, entries: [entry] })
  }
  return days
}
