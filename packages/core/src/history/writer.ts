import { createWriterDocument, nodeText, type WriterDocument, type WriterNode } from '#core/writer'

import { encodeHistoryValue } from './encode'
import type { HistoryAction, HistoryChangeSummary } from './model'

/**
 * A document-editor document as version-history records: one per top-level block of the body,
 * so a version that edited one paragraph stores one new record, plus the page setup, header,
 * footer, comments, and footnotes.
 */
const BLOCK = 'b:'
const PARTS = ['page', 'header', 'footer', 'comments', 'footnotes', 'settings'] as const

export function writerRecords(source: WriterDocument): [string, unknown][] {
  const blocks = source.body.content ?? []
  return [
    ['page', source.page],
    ['header', source.header],
    ['footer', source.footer],
    ['comments', source.comments],
    ['footnotes', source.footnotes],
    [
      'settings',
      {
        trackChanges: source.trackChanges,
        watermark: source.watermark,
        title: source.title,
        bodyAttrs: source.body.attrs ?? null
      }
    ],
    ...blocks.map((block, index): [string, unknown] => [
      BLOCK + String(index).padStart(6, '0'),
      block
    ])
  ]
}

type Settings = Pick<WriterDocument, 'trackChanges' | 'watermark' | 'title'> & {
  bodyAttrs: Record<string, unknown> | null
}

/** Reads records `writerRecords` wrote back into a document. */
export function writerFromRecords(records: Iterable<[string, unknown]>): WriterDocument {
  const parts = new Map<string, unknown>()
  const blocks: [string, WriterNode][] = []
  for (const [key, value] of records) {
    if (key.startsWith(BLOCK)) blocks.push([key, value as WriterNode])
    else if ((PARTS as readonly string[]).includes(key)) parts.set(key, value)
  }
  blocks.sort(([left], [right]) => left.localeCompare(right))
  const settings = (parts.get('settings') ?? {}) as Partial<Settings>
  const base = createWriterDocument()
  const body: WriterNode = { type: 'doc', content: blocks.map(([, block]) => block) }
  if (settings.bodyAttrs) body.attrs = settings.bodyAttrs
  return {
    ...base,
    body,
    page: (parts.get('page') as WriterDocument['page'] | undefined) ?? base.page,
    header: (parts.get('header') as WriterNode | null | undefined) ?? null,
    footer: (parts.get('footer') as WriterNode | null | undefined) ?? null,
    comments: (parts.get('comments') as WriterDocument['comments'] | undefined) ?? [],
    footnotes: (parts.get('footnotes') as WriterDocument['footnotes'] | undefined) ?? [],
    trackChanges: settings.trackChanges ?? false,
    watermark: settings.watermark ?? null,
    title: settings.title ?? ''
  }
}

export type DiffOp<T> =
  | { op: 'equal'; before: T; after: T }
  | { op: 'insert'; after: T }
  | { op: 'delete'; before: T }

/** Above this many cells the middle of a diff is compared as one replacement. */
const MAX_DIFF_CELLS = 4_000_000

/** The LCS diff of the part between a common prefix and suffix. */
function diffMiddle<T>(
  before: T[],
  after: T[],
  a: string[],
  b: string[],
  start: number,
  endA: number,
  endB: number
): DiffOp<T>[] {
  const ops: DiffOp<T>[] = []
  const rows = endA - start
  const cols = endB - start
  if (rows * cols > MAX_DIFF_CELLS) {
    for (let index = start; index < endA; index++) ops.push({ op: 'delete', before: before[index] })
    for (let index = start; index < endB; index++) ops.push({ op: 'insert', after: after[index] })
  } else {
    // lengths[i][j]: the common subsequence of a[start+i..] and b[start+j..].
    const lengths = Array.from({ length: rows + 1 }, () => new Uint32Array(cols + 1))
    for (let i = rows - 1; i >= 0; i--) {
      const row = lengths[i]
      const below = lengths[i + 1]
      for (let j = cols - 1; j >= 0; j--) {
        row[j] = a[start + i] === b[start + j] ? below[j + 1] + 1 : Math.max(below[j], row[j + 1])
      }
    }
    let i = 0
    let j = 0
    while (i < rows && j < cols) {
      if (a[start + i] === b[start + j]) {
        ops.push({ op: 'equal', before: before[start + i], after: after[start + j] })
        i++
        j++
      } else if (lengths[i + 1][j] >= lengths[i][j + 1]) {
        ops.push({ op: 'delete', before: before[start + i] })
        i++
      } else {
        ops.push({ op: 'insert', after: after[start + j] })
        j++
      }
    }
    for (; i < rows; i++) ops.push({ op: 'delete', before: before[start + i] })
    for (; j < cols; j++) ops.push({ op: 'insert', after: after[start + j] })
  }
  return ops
}

/** A longest-common-subsequence diff of two lists, compared by `key`. */
export function diffSequences<T>(before: T[], after: T[], key: (item: T) => string): DiffOp<T>[] {
  const a = before.map(key)
  const b = after.map(key)
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }
  const ops: DiffOp<T>[] = []
  for (let index = 0; index < start; index++) {
    ops.push({ op: 'equal', before: before[index], after: after[index] })
  }
  ops.push(...diffMiddle(before, after, a, b, start, endA, endB))
  for (let index = 0; index < a.length - endA; index++) {
    ops.push({ op: 'equal', before: before[endA + index], after: after[endB + index] })
  }
  return ops
}

/** A piece of a changed paragraph's text: kept, added, or removed. */
export interface WriterRunDiff {
  op: 'equal' | 'insert' | 'delete'
  text: string
}

export type WriterBlockDiff =
  | { kind: 'same'; block: WriterNode }
  | { kind: 'added'; block: WriterNode }
  | { kind: 'removed'; block: WriterNode }
  /** The same paragraph with its text or formatting changed, with the text's word diff. */
  | { kind: 'changed'; before: WriterNode; after: WriterNode; runs: WriterRunDiff[] }

/** Splits text into words and the spaces between them, so a diff reads in whole words. */
function words(text: string): string[] {
  return text.split(/(\s+)/u).filter((part) => part !== '')
}

/** A word diff of two texts, runs of the same kind merged. */
export function diffWriterText(before: string, after: string): WriterRunDiff[] {
  const runs: WriterRunDiff[] = []
  for (const op of diffSequences(words(before), words(after), (word) => word)) {
    const text = op.op === 'insert' ? op.after : op.before
    const last = runs.at(-1)
    if (last?.op === op.op) last.text += text
    else runs.push({ op: op.op, text })
  }
  return runs
}

/**
 * Compares two documents' bodies paragraph by paragraph, and the text of each paragraph that
 * changed word by word, as Google Docs shows a version against the one before it. A removed
 * paragraph directly followed by an added one is shown as that paragraph changed.
 */
export function diffWriterDocuments(
  before: WriterDocument,
  after: WriterDocument
): WriterBlockDiff[] {
  const ops = diffSequences(before.body.content ?? [], after.body.content ?? [], encodeHistoryValue)
  const result: WriterBlockDiff[] = []
  for (let index = 0; index < ops.length; index++) {
    const op = ops[index]
    if (op.op === 'equal') {
      result.push({ kind: 'same', block: op.after })
      continue
    }
    if (op.op === 'insert') {
      result.push({ kind: 'added', block: op.after })
      continue
    }
    // Pair the run of removals with the run of insertions after it.
    const removed: WriterNode[] = []
    for (let current = ops.at(index); current?.op === 'delete'; current = ops.at(++index)) {
      removed.push(current.before)
    }
    const added: WriterNode[] = []
    for (let current = ops.at(index); current?.op === 'insert'; current = ops.at(++index)) {
      added.push(current.after)
    }
    index--
    const paired = Math.min(removed.length, added.length)
    for (let pair = 0; pair < paired; pair++) {
      const old = removed[pair]
      const next = added[pair]
      result.push({
        kind: 'changed',
        before: old,
        after: next,
        runs: diffWriterText(nodeText(old), nodeText(next))
      })
    }
    for (const block of removed.slice(paired)) result.push({ kind: 'removed', block })
    for (const block of added.slice(paired)) result.push({ kind: 'added', block })
  }
  return result
}

const NAME_LENGTH = 40

function blockName(block: WriterNode): string {
  const text = nodeText(block).replace(/\s+/gu, ' ').trim()
  return text.length > NAME_LENGTH ? `${text.slice(0, NAME_LENGTH - 1)}…` : text
}

const KIND_ACTIONS = {
  changed: 'edit-text',
  added: 'create',
  removed: 'delete'
} as const satisfies Record<string, HistoryAction>

/** Describes an edit of a document by what it did to which paragraphs. */
export function summarizeWriterChange(
  before: WriterDocument,
  after: WriterDocument,
  label = 'Edit'
): HistoryChangeSummary {
  const diff = diffWriterDocuments(before, after).filter((entry) => entry.kind !== 'same')
  const kind = (['changed', 'added', 'removed'] as const).find((candidate) =>
    diff.some((entry) => entry.kind === candidate)
  )
  const action = kind ? KIND_ACTIONS[kind] : 'restyle'
  const entries = diff.filter((entry) => entry.kind === kind)
  return {
    action,
    count: entries.length,
    names: entries
      .map((entry) => blockName(entry.kind === 'changed' ? entry.after : entry.block))
      .filter((name) => name !== '')
      .slice(0, 3),
    label
  }
}
