import * as v from 'valibot'

export const historyAuthorSchema = v.object({
  id: v.string(),
  name: v.string(),
  /** A picture URL, or null for initials on a colour. */
  avatarUrl: v.nullable(v.string()),
  /** The colour drawn behind the author's initials, as `#rrggbb`. */
  color: v.nullable(v.string())
})

/** What kind of edit a change was, which the history panel words in the reader's language. */
export const historyActionSchema = v.picklist([
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

export const historyChangeSummarySchema = v.object({
  action: historyActionSchema,
  /** How many layers or paragraphs the change touched. */
  count: v.number(),
  /** The names of the first few, such as "Heading". */
  names: v.array(v.string()),
  /** The editor's own name for the step, such as "Move", in English. */
  label: v.string()
})

export const historyChangeSchema = v.object({
  id: v.string(),
  /** Milliseconds since the epoch. */
  at: v.number(),
  author: historyAuthorSchema,
  summary: historyChangeSummarySchema,
  /** Changes made in one sitting, by one author, share a session. */
  sessionId: v.string()
})

export const historyVersionKindSchema = v.picklist(['auto', 'named', 'restore'])

export const historyVersionSchema = v.object({
  id: v.string(),
  at: v.number(),
  author: historyAuthorSchema,
  kind: historyVersionKindSchema,
  title: v.nullable(v.string()),
  description: v.string(),
  /** The last change the version includes, or null for the document as it was opened. */
  changeId: v.nullable(v.string()),
  /** The version a restore brought back. */
  restoredFromId: v.nullable(v.string())
})

export const historyDocumentKindSchema = v.picklist(['design', 'writer'])

const manifestSchema = v.array(v.tuple([v.string(), v.string()]))

/** A document's whole history as persisted: changes, versions, and their deduplicated records. */
export const historyStateSchema = v.object({
  format: v.literal(1),
  documentKind: historyDocumentKindSchema,
  changes: v.array(historyChangeSchema),
  versions: v.array(historyVersionSchema),
  manifests: v.record(v.string(), manifestSchema),
  blobs: v.record(v.string(), v.string())
})
