import * as v from 'valibot'

/** The most edits one request may add; the editor sends what it recorded since the last one. */
export const DOCUMENT_HISTORY_BATCH_LIMIT = 200
export const DOCUMENT_HISTORY_NAMES_LIMIT = 10
export const DOCUMENT_HISTORY_NAME_MAX_LENGTH = 200

/** What kind of edit a change was, as the editor's version history words it. */
export const documentHistoryActionSchema = v.picklist([
  'create',
  'delete',
  'move',
  'resize',
  'rotate',
  'reorder',
  'rename',
  'edit-text',
  'restyle',
  'edit',
  'undo',
  'redo',
  'restore'
])
export type DocumentHistoryAction = v.InferOutput<typeof documentHistoryActionSchema>

export const documentHistorySummarySchema = v.object({
  action: documentHistoryActionSchema,
  /** How many layers or paragraphs the edit touched. */
  count: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(1_000_000)),
  /** The names of the first few. */
  names: v.pipe(
    v.array(v.pipe(v.string(), v.maxLength(DOCUMENT_HISTORY_NAME_MAX_LENGTH))),
    v.maxLength(DOCUMENT_HISTORY_NAMES_LIMIT)
  ),
  /** The editor's own name for the step, in English. */
  label: v.pipe(v.string(), v.maxLength(100))
})
export type DocumentHistorySummary = v.InferOutput<typeof documentHistorySummarySchema>

/** An edit as the editor recorded it; who made it is the signed-in person sending it. */
export const documentHistoryChangeInputSchema = v.object({
  /** The editor's id for the edit, so sending it again adds nothing. */
  id: v.pipe(v.string(), v.minLength(1), v.maxLength(64)),
  /** When it was made; a time after the server's own is taken as now. */
  at: v.pipe(v.string(), v.isoTimestamp()),
  sessionId: v.pipe(v.string(), v.minLength(1), v.maxLength(64)),
  summary: documentHistorySummarySchema
})
export type DocumentHistoryChangeInput = v.InferOutput<typeof documentHistoryChangeInputSchema>

export const appendDocumentHistorySchema = v.object({
  changes: v.pipe(
    v.array(documentHistoryChangeInputSchema),
    v.minLength(1),
    v.maxLength(DOCUMENT_HISTORY_BATCH_LIMIT)
  )
})
export type AppendDocumentHistoryInput = v.InferOutput<typeof appendDocumentHistorySchema>

export const documentHistoryChangeSchema = v.object({
  id: v.string(),
  at: v.string(),
  sessionId: v.string(),
  summary: documentHistorySummarySchema,
  author: v.object({ id: v.string(), name: v.nullable(v.string()) })
})
export type DocumentHistoryChange = v.InferOutput<typeof documentHistoryChangeSchema>

export const documentHistoryPageSchema = v.object({
  /** Newest first. */
  changes: v.array(documentHistoryChangeSchema),
  /** Pass as `before` for the next, older page; null on the last one. */
  nextCursor: v.nullable(v.string())
})
export type DocumentHistoryPage = v.InferOutput<typeof documentHistoryPageSchema>

export const appendDocumentHistoryResponseSchema = v.object({
  /** How many of the changes sent were new. */
  added: v.number()
})

export function parseAppendDocumentHistory(input: unknown): AppendDocumentHistoryInput {
  return v.parse(appendDocumentHistorySchema, input)
}
