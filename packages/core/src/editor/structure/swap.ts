import type { SceneGraph, SceneNode } from '@lawha/scene-graph'

import { restoreSubtree, snapshotSubtree } from '#core/editor/history/subtree'
import { fitEnclosingGroupsWithUndo } from '#core/editor/structure/group/bounds'
import type { EditorContext } from '#core/editor/types'

/** A layer, where it sits, and a copy of it with its children, to put it back. */
export interface LayerPlace {
  id: string
  parentId: string
  index: number
  snapshot: Map<string, SceneNode>
}

/** Where `id` sits now, with a copy of it; null for a layer without a parent. */
export function placeOf(ctx: EditorContext, id: string): LayerPlace | null {
  const parentId = ctx.graph.getNode(id)?.parentId
  const parent = parentId ? ctx.graph.getNode(parentId) : undefined
  if (!parent) return null
  return {
    id,
    parentId: parent.id,
    index: parent.childIds.indexOf(id),
    snapshot: snapshotSubtree(ctx.graph, id)
  }
}

/** Puts layers back where they were, lowest index first so each lands at its own index. */
function restorePlaces(ctx: EditorContext, places: readonly LayerPlace[]) {
  for (const { id, parentId, index, snapshot } of places.toSorted((a, b) => a.index - b.index)) {
    const root = snapshot.get(id)
    if (!root || ctx.graph.getNode(id)) continue
    restoreSubtree(ctx.graph, root, parentId, snapshot)
    ctx.graph.insertChildAt(id, parentId, index)
  }
}

/**
 * Records, as one undo step, an edit that already replaced the `removed` layers with `madeIds`:
 * selects what it made, refits the groups around them, and lets undo and redo swap them back.
 * Layers both removed and made, edited in place, are put back as they were and as they became.
 */
export function recordLayerSwap(
  ctx: EditorContext,
  label: string,
  removed: readonly LayerPlace[],
  madeIds: readonly string[],
  prevSelection: ReadonlySet<string>
): void {
  const made = madeIds.flatMap((id) => placeOf(ctx, id) ?? [])
  const parentIds = new Set([...removed, ...made].map((place) => place.parentId))
  for (const parentId of parentIds) ctx.runLayoutForNode(parentId)
  const selection = new Set(madeIds)
  ctx.setSelectedIds(selection)
  ctx.undo.runBatch(label, () => {
    ctx.undo.push({
      label,
      forward: () => {
        for (const { id } of removed) ctx.graph.deleteNode(id)
        restorePlaces(ctx, made)
        for (const parentId of parentIds) ctx.runLayoutForNode(parentId)
        ctx.setSelectedIds(new Set(selection))
      },
      inverse: () => {
        for (const { id } of made) ctx.graph.deleteNode(id)
        restorePlaces(ctx, removed)
        for (const parentId of parentIds) ctx.runLayoutForNode(parentId)
        ctx.setSelectedIds(new Set(prevSelection))
      }
    })
    fitEnclosingGroupsWithUndo(ctx, parentIds)
  })
}

/**
 * Replaces `node` with a vector made from `props`, at its place in its parent, and returns the
 * vector's id; null for a layer without a parent.
 */
export function replaceWithVector(
  graph: SceneGraph,
  node: SceneNode,
  props: Partial<SceneNode>
): string | null {
  const parent = node.parentId ? graph.getNode(node.parentId) : undefined
  if (!parent) return null
  const index = parent.childIds.indexOf(node.id)
  const vector = graph.createNode('VECTOR', parent.id, props)
  graph.insertChildAt(vector.id, parent.id, index)
  graph.deleteNode(node.id)
  return vector.id
}
