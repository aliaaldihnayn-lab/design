import * as v from 'valibot'

import { designDiffFromKeys, designRecordNodeId } from '#core/history/design'
import type { HistoryVersion } from '#core/history/model'
import type { DocumentHistory } from '#core/history/timeline'
import { diffWriterDocuments, writerFromRecords } from '#core/history/writer'
import { defineTool } from '#core/tools/schema'
import { nodeText } from '#core/writer/model'

import { requireVersionHistory, type VersionHistoryTarget } from './host'

const kindSchema = v.optional(
  v.pipe(
    v.picklist(['design', 'writer']),
    v.description(
      'Which open document: the design on the canvas (default) or the document in the document editor (writer).'
    )
  ),
  'design'
)

/** How much of each list a tool answer carries, so a long history stays a short answer. */
const LIST_LIMIT = 50

function versionInfo(history: DocumentHistory, version: HistoryVersion) {
  const restoredFrom = version.restoredFromId ? history.getVersion(version.restoredFromId) : null
  return {
    id: version.id,
    kind: version.kind,
    title: version.title,
    description: version.description,
    savedAt: new Date(version.at).toISOString(),
    author: version.author.name || null,
    restoredFrom: restoredFrom ? { id: restoredFrom.id, title: restoredFrom.title } : null
  }
}

export const listVersions = defineTool({
  name: 'list_versions',
  description:
    'List the version history of the open design or document, newest first: saved versions (named, automatic, and restores) with ids for restore_version and diff_versions, and the most recent edits with who made them and what they did.',
  execution: { kind: 'sync', mutation: 'none' },
  input: v.strictObject({
    kind: kindSchema,
    limit: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(LIST_LIMIT)), 20)
  }),
  execute: (_figma, args) => {
    const { history } = requireVersionHistory(args.kind)
    const versions = history.listVersions().toReversed()
    const changes = history.listChanges().toReversed()
    return {
      versions: versions.slice(0, args.limit).map((version) => versionInfo(history, version)),
      totalVersions: versions.length,
      recentEdits: changes.slice(0, args.limit).map((change) => ({
        at: new Date(change.at).toISOString(),
        author: change.author.name || null,
        ...change.summary
      })),
      totalEdits: changes.length
    }
  }
})

export const saveVersion = defineTool({
  name: 'save_version',
  description:
    'Save the open design or document as it is now as a named version in its version history, with a title and an optional description of what changed, as Save version does. It does not change the document.',
  execution: { kind: 'async', mutation: 'none' },
  input: v.strictObject({
    kind: kindSchema,
    title: v.pipe(
      v.string(),
      v.regex(/\S/, 'Expected a nonblank title'),
      // A transform, not v.trim(), which has no JSON Schema form for MCP to list.
      v.transform((title) => title.trim()),
      v.maxLength(100)
    ),
    description: v.optional(v.pipe(v.string(), v.maxLength(1000)), '')
  }),
  execute: async (_figma, args) => {
    const target = requireVersionHistory(args.kind)
    const version = await target.save(args.title, args.description)
    if (!version) throw new Error('The version could not be saved')
    return { saved: versionInfo(target.history, version) }
  }
})

export const restoreVersion = defineTool({
  name: 'restore_version',
  description:
    'Restore a version from list_versions: the document becomes what it was then. Nothing is lost: the document as it is now is kept as a version first, and the restore is an edit of its own that can be undone.',
  execution: { kind: 'async', mutation: 'document' },
  input: v.strictObject({
    kind: kindSchema,
    versionId: v.pipe(v.string(), v.minLength(1))
  }),
  execute: async (_figma, args) => {
    const target = requireVersionHistory(args.kind)
    const source = target.history.getVersion(args.versionId)
    if (!source) throw new Error(`No version ${args.versionId}; list_versions gives their ids`)
    const restored = await target.restore(args.versionId)
    return {
      restored: versionInfo(target.history, source),
      newVersion: restored ? versionInfo(target.history, restored) : null
    }
  }
})

/** The layer names records hold, by layer id. */
function layerNames(records: Iterable<[string, unknown]>): Map<string, string> {
  const names = new Map<string, string>()
  for (const [key, node] of records) {
    const id = designRecordNodeId(key)
    if (id && typeof node === 'object' && node && 'name' in node && typeof node.name === 'string') {
      names.set(id, node.name)
    }
  }
  return names
}

/** A version's records, or the document's as it is now for `current`. */
function recordsOf(target: VersionHistoryTarget, versionId: string) {
  return versionId === 'current'
    ? target.currentRecords()
    : target.history.versionRecords(versionId)
}

export const diffVersions = defineTool({
  name: 'diff_versions',
  description:
    'Compare two versions from list_versions, or a version with the document now ("current"). For a design: the layers added, removed, and changed, by id and name. For a document: the paragraphs added, removed, and changed, with the words that changed.',
  execution: { kind: 'sync', mutation: 'none' },
  input: v.strictObject({
    kind: kindSchema,
    from: v.pipe(v.string(), v.minLength(1), v.description('The older version id.')),
    to: v.optional(
      v.pipe(v.string(), v.minLength(1), v.description('The newer version id, or "current".')),
      'current'
    )
  }),
  execute: (_figma, args) => {
    const target = requireVersionHistory(args.kind)
    for (const id of [args.from, args.to]) {
      if (id !== 'current' && !target.history.getVersion(id)) {
        throw new Error(`No version ${id}; list_versions gives their ids`)
      }
    }
    if (args.kind === 'writer') {
      const before = writerFromRecords(recordsOf(target, args.from))
      const after = writerFromRecords(recordsOf(target, args.to))
      const blocks = diffWriterDocuments(before, after).filter((entry) => entry.kind !== 'same')
      return {
        changedParagraphs: blocks.length,
        paragraphs: blocks.slice(0, LIST_LIMIT).map((entry) =>
          entry.kind === 'changed'
            ? {
                change: 'changed' as const,
                before: nodeText(entry.before),
                after: nodeText(entry.after),
                added: entry.runs.filter((run) => run.op === 'insert').map((run) => run.text),
                removed: entry.runs.filter((run) => run.op === 'delete').map((run) => run.text)
              }
            : { change: entry.kind, text: nodeText(entry.block) }
        )
      }
    }
    const diff = designDiffFromKeys(
      args.to === 'current'
        ? target.history.diffWithCurrent(args.from, target.currentRecords())
        : target.history.diffVersions(args.from, args.to)
    )
    // Names come from the newer side, else the older one, which still has removed layers.
    const newer = layerNames(recordsOf(target, args.to))
    const older = layerNames(recordsOf(target, args.from))
    const layer = (id: string) => ({ id, name: newer.get(id) ?? older.get(id) ?? null })
    return {
      added: diff.added.slice(0, LIST_LIMIT).map(layer),
      removed: diff.removed.slice(0, LIST_LIMIT).map(layer),
      changed: diff.changed.slice(0, LIST_LIMIT).map(layer),
      counts: {
        added: diff.added.length,
        removed: diff.removed.length,
        changed: diff.changed.length
      },
      variablesOrSettingsChanged: diff.documentChanged
    }
  }
})
