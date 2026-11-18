import type { SceneGraph } from '@lawha/scene-graph'
import type { UndoStepEvent } from '@lawha/scene-graph/undo'

import {
  createDesignChangeTracker,
  designPendingPages,
  designRecords,
  graphFromDesignRecords,
  restoreDesignGraph,
  RESTORE_VERSION_LABEL,
  type DesignRestoreHost
} from './design'
import type { HistoryAuthor, HistoryChange, HistoryVersion } from './model'
import type { DocumentHistory } from './timeline'

/** What a design editor gives the recorder: its undo steps and its graph's change events. */
export interface DesignHistorySource {
  readonly graph: SceneGraph
  readonly undo: { onStep(listener: (event: UndoStepEvent) => void): () => void }
  onEditorEvent(event: 'graph:replaced', handler: (graph: SceneGraph) => void): () => void
}

export interface DesignHistoryRecorderOptions {
  source: DesignHistorySource
  history: DocumentHistory
  author: () => HistoryAuthor
  /** Keeps an automatic version after this many changes; the app also checkpoints when idle. */
  autoVersionEvery?: number
  /** Called after each recorded change, as for persisting the history. */
  onRecorded?: (change: HistoryChange) => void
}

export const DEFAULT_AUTO_VERSION_EVERY = 50

/**
 * Records a design editor's history from the steps its undo commits, undoes, and redoes, each
 * described by what the graph reported changing, and keeps automatic versions as edits pile up.
 * There is no second change tracker: a step undo does not record, history does not either.
 */
export function createDesignHistoryRecorder(options: DesignHistoryRecorderOptions) {
  const { source, history, author } = options
  const every = options.autoVersionEvery ?? DEFAULT_AUTO_VERSION_EVERY
  const tracker = createDesignChangeTracker(() => source.graph)
  let paused = 0

  const bind = (graph: SceneGraph) => {
    const stopEvents = graph.onNodeEvents(tracker.handlers)
    const stopObserving = graph.observeNodeChanges(tracker.observer)
    return () => {
      stopEvents()
      stopObserving()
    }
  }
  let unbindGraph = bind(source.graph)
  const stopReplaced = source.onEditorEvent('graph:replaced', (graph) => {
    unbindGraph()
    tracker.reset()
    unbindGraph = bind(graph)
  })

  const stopSteps = source.undo.onStep((event) => {
    const summary = tracker.take(event.label)
    if (paused > 0) return
    if (event.kind !== 'record') summary.action = event.kind
    else if (event.label === RESTORE_VERSION_LABEL) summary.action = 'restore'
    const change = history.recordChange({ author: author(), summary, coalesce: event.coalesced })
    options.onRecorded?.(change)
    if (history.changesSinceLatestVersion().length >= every) checkpoint()
  })

  /** Keeps an automatic version of the document now, unless it equals the newest one. */
  function checkpoint(): HistoryVersion | null {
    return history.saveVersion({ author: author(), records: designRecords(source.graph) })
  }

  return {
    checkpoint,
    /** Saves a named version, as Save version with a title and description. */
    saveNamed(title: string, description = ''): HistoryVersion | null {
      return history.saveVersion({
        author: author(),
        records: designRecords(source.graph),
        kind: 'named',
        title,
        description
      })
    },
    /** Runs `run` without recording its steps, as for loading a document. */
    paused<T>(run: () => T): T {
      paused++
      try {
        return run()
      } finally {
        paused--
      }
    },
    dispose() {
      stopSteps()
      stopReplaced()
      unbindGraph()
    }
  }
}

export type DesignHistoryRecorder = ReturnType<typeof createDesignHistoryRecorder>

export interface RestoreDesignVersionInput {
  history: DocumentHistory
  host: DesignRestoreHost
  versionId: string
  author: HistoryAuthor
}

/**
 * Brings a version back as Figma's Restore this version does, losing nothing: the document as it
 * was is kept as a version first, the restore is one undoable edit that history records as a
 * change, and a version marked as restored from the old one holds the result.
 */
export function restoreDesignVersion(input: RestoreDesignVersionInput): HistoryVersion {
  const { history, host, versionId, author } = input
  const version = history.getVersion(versionId)
  if (!version) throw new Error(`No version ${versionId}`)
  const records = history.versionRecords(versionId)
  const target = graphFromDesignRecords(records)
  history.saveVersion({ author, records: designRecords(host.graph) })
  restoreDesignGraph(host, target, designPendingPages(records))
  const restored = history.saveVersion({
    author,
    records: designRecords(host.graph),
    kind: 'restore',
    restoredFromId: version.id
  })
  if (!restored) throw new Error('The restored version could not be kept')
  return restored
}
