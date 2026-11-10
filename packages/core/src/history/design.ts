import { compact } from 'es-toolkit'

import type {
  NodeChangeObserver,
  SceneGraph,
  SceneNode,
  Variable,
  VariableCollection
} from '@lawha/scene-graph'

import { snapshotPage, type PageSnapshot } from '#core/editor/history/snapshot/page'
import {
  deserializeSceneGraph,
  serializeSceneGraph,
  type SerializedSceneGraph
} from '#core/kiwi/fig/parse/transfer'

import type { HistoryAction, HistoryChangeSummary } from './model'

/**
 * A design document as version-history records: one per layer, variable, collection, and image,
 * plus the document's own settings, so a version that moved one layer stores one record.
 */
const META = 'meta'
const NODE = 'n:'
const VARIABLE = 'v:'
const COLLECTION = 'c:'
const IMAGE = 'i:'

type DesignMeta = Omit<
  SerializedSceneGraph,
  'nodes' | 'images' | 'variables' | 'variableCollections' | 'instanceIndex'
>

export function designRecords(graph: SceneGraph): [string, unknown][] {
  const data = serializeSceneGraph(graph)
  const meta: DesignMeta = {
    rootId: data.rootId,
    activeMode: data.activeMode,
    figKiwiVersion: data.figKiwiVersion,
    figSchemaDeflated: data.figSchemaDeflated,
    documentColorSpace: data.documentColorSpace,
    documentKind: data.documentKind,
    enabledLibraries: data.enabledLibraries
  }
  return [
    [META, meta],
    ...data.nodes.map(([id, node]): [string, unknown] => [NODE + id, node]),
    ...data.variables.map(([id, variable]): [string, unknown] => [VARIABLE + id, variable]),
    ...data.variableCollections.map(([id, item]): [string, unknown] => [COLLECTION + id, item]),
    ...data.images.map(([hash, bytes]): [string, unknown] => [IMAGE + hash, bytes])
  ]
}

function isMeta(value: unknown): value is DesignMeta {
  return typeof value === 'object' && value !== null && 'rootId' in value
}

/** Builds a standalone graph from records `designRecords` wrote. */
export function graphFromDesignRecords(records: Iterable<[string, unknown]>): SceneGraph {
  let meta: DesignMeta | null = null
  const nodes: [string, SceneNode][] = []
  const variables: [string, Variable][] = []
  const collections: [string, VariableCollection][] = []
  const images: [string, Uint8Array][] = []
  for (const [key, value] of records) {
    if (key === META && isMeta(value)) meta = value
    else if (key.startsWith(NODE)) nodes.push([key.slice(NODE.length), value as SceneNode])
    else if (key.startsWith(VARIABLE)) {
      variables.push([key.slice(VARIABLE.length), value as Variable])
    } else if (key.startsWith(COLLECTION)) {
      collections.push([key.slice(COLLECTION.length), value as VariableCollection])
    } else if (key.startsWith(IMAGE) && value instanceof Uint8Array) {
      images.push([key.slice(IMAGE.length), value])
    }
  }
  if (!meta) throw new Error('The version has no document settings')
  const instanceIndex = new Map<string, string[]>()
  for (const [id, node] of nodes) {
    if (node.type !== 'INSTANCE' || !node.componentId) continue
    instanceIndex.set(node.componentId, [...(instanceIndex.get(node.componentId) ?? []), id])
  }
  const graph = deserializeSceneGraph({
    ...meta,
    nodes,
    variables,
    variableCollections: collections,
    images,
    instanceIndex: [...instanceIndex]
  })
  graph.clearAbsPosCache()
  return graph
}

/** The layer id a record key names, or null for records that are not layers. */
export function designRecordNodeId(key: string): string | null {
  return key.startsWith(NODE) ? key.slice(NODE.length) : null
}

export interface DesignVersionDiff {
  /** Layers in the newer state that the older lacks. */
  added: string[]
  /** Layers the older state has and the newer lacks. */
  removed: string[]
  /** Layers in both whose own fields differ. */
  changed: string[]
  /** Whether variables, collections, images, or document settings differ. */
  documentChanged: boolean
}

/** Splits a record diff into the layers it names and the rest of the document. */
export function designDiffFromKeys(diff: {
  added: string[]
  removed: string[]
  changed: string[]
}): DesignVersionDiff {
  const nodes = (keys: string[]) =>
    keys.map(designRecordNodeId).filter((id): id is string => id !== null)
  const other = [...diff.added, ...diff.removed, ...diff.changed].some(
    (key) => designRecordNodeId(key) === null
  )
  return {
    added: nodes(diff.added),
    removed: nodes(diff.removed),
    changed: nodes(diff.changed),
    documentChanged: other
  }
}

/** What an editor gives version history so a restore runs as one undoable edit. */
export interface DesignRestoreHost {
  readonly graph: SceneGraph
  recordEdit<T>(options: { label: string }, run: () => T): T
  restorePageFromSnapshot(snapshot: PageSnapshot): void
  clearSelection(): void
  requestRender(): void
}

export const RESTORE_VERSION_LABEL = 'Restore version'

const PAGE_FIXED_FIELDS = new Set(['id', 'parentId', 'childIds', 'type'])

/**
 * Makes the live document hold what `target` holds, page by page, as one undo step labelled
 * "Restore version": undo takes the restore back, and history records it as a change of its own,
 * so the state before it is never lost. Layer ids are kept, as the version saved them.
 */
export function restoreDesignGraph(host: DesignRestoreHost, target: SceneGraph): void {
  host.recordEdit({ label: RESTORE_VERSION_LABEL }, () => {
    const graph = host.graph
    host.clearSelection()
    for (const [hash, bytes] of target.images) {
      if (!graph.images.has(hash)) graph.images.set(hash, bytes)
    }
    const targetPages = target.getPages()
    const keep = new Set(targetPages.map((page) => page.id))
    targetPages.forEach((page, index) => {
      const fields = Object.fromEntries(
        Object.entries(structuredClone(page)).filter(([key]) => !PAGE_FIXED_FIELDS.has(key))
      ) as Partial<SceneNode>
      if (graph.getNode(page.id)) graph.updateNode(page.id, fields)
      else graph.createNode('CANVAS', graph.rootId, { ...fields, id: page.id, childIds: [] })
      host.restorePageFromSnapshot(snapshotPage(target, page.id))
      graph.insertChildAt(page.id, graph.rootId, index)
    })
    for (const page of graph.getPages()) {
      if (!keep.has(page.id)) graph.deleteNode(page.id)
    }
    host.requestRender()
  })
}

const FIELD_ACTIONS: [HistoryAction, readonly string[]][] = [
  ['edit-text', ['text', 'styleRuns', 'textParagraphs']],
  ['move', ['x', 'y']],
  ['resize', ['width', 'height']],
  ['rotate', ['rotation']],
  ['rename', ['name']]
]

/** The order an edit that did several things is described by: its most telling part first. */
const ACTION_PRIORITY: HistoryAction[] = [
  'create',
  'delete',
  'edit-text',
  'move',
  'resize',
  'rotate',
  'rename',
  'reorder',
  'restyle'
]

function fieldAction(fields: string[]): HistoryAction {
  for (const [action, names] of FIELD_ACTIONS) {
    if (fields.some((field) => names.includes(field))) return action
  }
  return 'restyle'
}

/** How many names a summary keeps; the panel says "and n more" for the rest. */
const SUMMARY_NAMES = 3

/**
 * Watches what the graph reports changing between undo steps, so each step can be described by
 * what it did to which layers, such as "Moved 3 layers" or "Edited text in Heading".
 */
export function createDesignChangeTracker(graph: () => SceneGraph) {
  const touched = new Map<HistoryAction, Map<string, string>>()
  const names = new Map<string, string>()

  const nameOf = (id: string) => graph().getNode(id)?.name ?? names.get(id) ?? ''
  const isLayer = (id: string) => {
    const node = graph().getNode(id)
    return !node || (node.type !== 'CANVAS' && node.id !== graph().rootId)
  }
  const mark = (action: HistoryAction, id: string) => {
    if (!isLayer(id)) return
    const name = nameOf(id)
    if (name) names.set(id, name)
    let ids = touched.get(action)
    if (!ids) touched.set(action, (ids = new Map()))
    ids.set(id, name)
  }

  const handlers = {
    created: (node: SceneNode) => mark('create', node.id),
    updated: (id: string, changes: Partial<SceneNode>) =>
      mark(fieldAction(Object.keys(changes)), id),
    deleted: (id: string) => {
      // A layer made and removed in one step was never there.
      if (touched.get('create')?.delete(id)) return
      mark('delete', id)
    },
    reparented: (id: string) => mark('move', id),
    reordered: (id: string) => mark('reorder', id)
  }

  /** Remembers names as layers are about to change, so a deleted layer is still named. */
  const observer: NodeChangeObserver = {
    before: (node) => {
      if (node.name) names.set(node.id, node.name)
    },
    created: () => undefined
  }

  return {
    handlers,
    observer,
    /** Describes the step that just ended and starts over for the next. */
    take(label: string): HistoryChangeSummary {
      const action = ACTION_PRIORITY.find((candidate) => (touched.get(candidate)?.size ?? 0) > 0)
      const ids = action ? (touched.get(action) ?? new Map<string, string>()) : new Map()
      const summary: HistoryChangeSummary = {
        action: action ?? 'edit',
        count: ids.size,
        names: compact([...ids.values()]).slice(0, SUMMARY_NAMES),
        label
      }
      touched.clear()
      names.clear()
      return summary
    },
    reset() {
      touched.clear()
      names.clear()
    }
  }
}
