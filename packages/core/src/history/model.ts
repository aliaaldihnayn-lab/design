import type * as v from 'valibot'

import type {
  historyActionSchema,
  historyAuthorSchema,
  historyChangeSchema,
  historyChangeSummarySchema,
  historyDocumentKindSchema,
  historyStateSchema,
  historyVersionKindSchema,
  historyVersionSchema
} from './schema'

export type HistoryAuthor = v.InferOutput<typeof historyAuthorSchema>
export type HistoryAction = v.InferOutput<typeof historyActionSchema>
export type HistoryChangeSummary = v.InferOutput<typeof historyChangeSummarySchema>
export type HistoryChange = v.InferOutput<typeof historyChangeSchema>
export type HistoryVersionKind = v.InferOutput<typeof historyVersionKindSchema>
export type HistoryVersion = v.InferOutput<typeof historyVersionSchema>
export type HistoryDocumentKind = v.InferOutput<typeof historyDocumentKindSchema>
export type HistoryState = v.InferOutput<typeof historyStateSchema>

/** Changes further apart than this start a new session, as Google Docs groups edits. */
export const HISTORY_SESSION_GAP_MS = 30 * 60 * 1000

/** How much history a document keeps; named versions and restores are kept regardless. */
export interface HistoryRetention {
  /** Automatic versions kept, newest first. */
  maxAutoVersions: number
  /** Automatic versions older than this are dropped. */
  maxAutoAgeMs: number
  /** Change entries kept, newest first. */
  maxChanges: number
}

export const DEFAULT_HISTORY_RETENTION: HistoryRetention = {
  maxAutoVersions: 100,
  maxAutoAgeMs: 30 * 24 * 60 * 60 * 1000,
  maxChanges: 5000
}

/** The author of changes nobody signed, such as those of a document opened from a file. */
export const UNKNOWN_HISTORY_AUTHOR: HistoryAuthor = {
  id: 'local',
  name: '',
  avatarUrl: null,
  color: null
}
