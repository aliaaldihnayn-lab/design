import { Extension } from '@tiptap/core'
import { Fragment, Slice, type Mark, type Node as ProseMirrorNode } from '@tiptap/pm/model'
import {
  Plugin,
  PluginKey,
  TextSelection,
  type EditorState,
  type Transaction
} from '@tiptap/pm/state'
import { ReplaceStep, type Mapping } from '@tiptap/pm/transform'

/**
 * Track changes as Word records them: while on, typed text carries an `insertion` mark and
 * deleted text stays in place with a `deletion` mark, each signed with the author and time. The
 * marks are what `@lawha/core/writer` writes as `w:ins` and `w:del`.
 */
export const trackChangesKey = new PluginKey('writerTrackChanges')

export interface TrackChangesOptions {
  enabled: () => boolean
  author: () => string
  now?: () => string
}

function markSlice(slice: Slice, mark: Mark): Slice {
  const mapFragment = (fragment: Fragment): Fragment => {
    const nodes: ProseMirrorNode[] = []
    fragment.forEach((node) => {
      if (node.isText)
        nodes.push(mark.isInSet(node.marks) ? node : node.mark(mark.addToSet(node.marks)))
      else nodes.push(node.copy(mapFragment(node.content)))
    })
    return Fragment.fromArray(nodes)
  }
  return new Slice(mapFragment(slice.content), slice.openStart, slice.openEnd)
}

function textNodes(slice: Slice): ProseMirrorNode[] {
  const nodes: ProseMirrorNode[] = []
  slice.content.descendants((node) => {
    if (node.isText) nodes.push(node)
    return !node.isText
  })
  return nodes
}

/** Whether every piece of text in the slice is the author's own pending insertion. */
function onlyOwnInsertions(slice: Slice, author: string): boolean {
  const nodes = textNodes(slice)
  return (
    nodes.length > 0 &&
    nodes.every(
      (node) => node.marks.find((mark) => mark.type.name === 'insertion')?.attrs.author === author
    )
  )
}

function onlyDeletions(slice: Slice): boolean {
  const nodes = textNodes(slice)
  return (
    nodes.length > 0 &&
    nodes.every((node) => node.marks.some((mark) => mark.type.name === 'deletion'))
  )
}

/** Rewrites one user transaction's replace steps as tracked insertions and deletions. */
function trackTransaction(
  source: Transaction,
  oldState: EditorState,
  newState: EditorState,
  options: TrackChangesOptions
): Transaction | null {
  const schema = newState.schema
  const author = options.author() || 'Lawha'
  const attrs = { author, date: (options.now ?? (() => new Date().toISOString()))() }
  const insertion = schema.marks.insertion.create(attrs)
  const deletion = schema.marks.deletion.create(attrs)
  const tr = newState.tr.setMeta(trackChangesKey, true).setMeta('addToHistory', true)
  let selection: number | null = null
  const wasBackward = oldState.selection.empty

  for (const [index, step] of source.steps.entries()) {
    if (!(step instanceof ReplaceStep)) continue
    const before = source.docs[index]
    const rest: Mapping = source.mapping.slice(index + 1)
    const toNow = (pos: number, assoc: -1 | 1) =>
      // eslint-disable-next-line unicorn/no-array-method-this-argument -- Mapping.map takes an association side, not a thisArg.
      tr.mapping.map(rest.map(pos, assoc), assoc)
    const { from, to } = step
    const inserted = step.slice.size
    if (inserted > 0) {
      const start = toNow(from, -1)
      const end = toNow(from + inserted, 1)
      tr.removeMark(start, end, schema.marks.deletion)
      tr.addMark(start, end, insertion)
    }
    if (to > from) {
      const removed = before.slice(from, to)
      if (onlyOwnInsertions(removed, author)) continue
      const at = toNow(from, -1)
      const alreadyDeleted = onlyDeletions(removed)
      tr.replace(at, at, alreadyDeleted ? removed : markSlice(removed, deletion))
      // Backspace leaves the caret before the struck text, Delete after it, as Word does.
      const backward = wasBackward && oldState.selection.from === to
      selection = backward ? at : at + removed.size
    }
  }
  if (!tr.docChanged) return null
  if (selection !== null) tr.setSelection(TextSelection.create(tr.doc, selection))
  return tr
}

/** The ProseMirror plugin, usable without an editor view (the tests drive it on states). */
export function trackChangesPlugin(options: TrackChangesOptions): Plugin {
  return new Plugin({
    key: trackChangesKey,
    appendTransaction(transactions, oldState, newState) {
      if (!options.enabled() || transactions.length !== 1) return null
      const [source] = transactions
      if (!source.docChanged || source.getMeta(trackChangesKey) || source.getMeta('history$')) {
        return null
      }
      if (source.getMeta('preventTracking')) return null
      return trackTransaction(source, oldState, newState, options)
    }
  })
}

export const TrackChanges = Extension.create<TrackChangesOptions>({
  name: 'writerTrackChanges',
  addOptions: () => ({ enabled: () => false, author: () => '' }),
  addProseMirrorPlugins() {
    return [trackChangesPlugin(this.options)]
  }
})

/** One tracked change: a run of inserted or deleted text by one author. */
export interface TrackedChange {
  type: 'insertion' | 'deletion'
  from: number
  to: number
  author: string
  date: string
  text: string
}

export function trackedChanges(doc: ProseMirrorNode): TrackedChange[] {
  const changes: TrackedChange[] = []
  doc.descendants((node, pos) => {
    if (!node.isText) return true
    for (const mark of node.marks) {
      const type = mark.type.name
      if (type !== 'insertion' && type !== 'deletion') continue
      const last = changes.at(-1)
      const author = String(mark.attrs.author ?? '')
      if (last?.type === type && last.to === pos && last.author === author) {
        last.to = pos + node.nodeSize
        last.text += node.text ?? ''
      } else {
        changes.push({
          type,
          from: pos,
          to: pos + node.nodeSize,
          author,
          date: String(mark.attrs.date ?? ''),
          text: node.text ?? ''
        })
      }
    }
    return false
  })
  return changes
}

/** Accepts or rejects changes; the edit itself is not tracked. */
export function resolveChanges(
  state: EditorState,
  changes: readonly TrackedChange[],
  accept: boolean
): Transaction {
  const tr = state.tr.setMeta(trackChangesKey, true)
  for (const change of [...changes].sort((a, b) => b.from - a.from)) {
    const keep = (change.type === 'insertion') === accept
    if (keep) tr.removeMark(change.from, change.to, state.schema.marks[change.type])
    else tr.delete(change.from, change.to)
  }
  return tr
}
