import type { SceneGraph, SceneNode } from '@lawha/scene-graph'
import { fitEnclosingGroups, type GroupFitOptions } from '@lawha/scene-graph/group-bounds'
import { MAX_BLEND_STEPS, type LiveBlend } from '@lawha/scene-graph/path-effects'
import { LAWHA_PLUGIN_DATA, readPluginData, withPluginData } from '@lawha/scene-graph/plugin-data'
import type { Vector } from '@lawha/scene-graph/primitives'

import { blendStepProps, canTakePathEffect, outlineCentre } from '#core/canvas/path-effects'
import type { SkiaRenderer } from '#core/canvas/renderer'
import { shapeBuilderSourcePath } from '#core/canvas/shape-builder'

import { wrapNodes } from './container-wrap'
import { ungroupNode } from './group/ungroup'

/** How a live blend spaces its steps. */
export interface BlendSpacing {
  spacing: LiveBlend['spacing']
  steps: number
  distance: number
}

/** The live blend a group holds, if it holds a valid one whose ends are still its children. */
export function liveBlendOf(graph: SceneGraph, group: SceneNode): LiveBlend | undefined {
  const blend = readPluginData(group.pluginData, LAWHA_PLUGIN_DATA.liveBlend)
  if (!blend) return undefined
  const ends = [blend.fromId, blend.toId]
  return ends.every((id) => graph.getNode(id)?.parentId === group.id) ? blend : undefined
}

/** The live blend group a layer is, or sits directly in. */
export function enclosingLiveBlend(graph: SceneGraph, node: SceneNode) {
  for (const candidate of [node, node.parentId ? graph.getNode(node.parentId) : undefined]) {
    const blend = candidate && liveBlendOf(graph, candidate)
    if (candidate && blend) return { group: candidate, blend }
  }
  return null
}

/** A spine's centre line in its parent, measured: its length and the point at a share of it. */
function measureSpine(r: SkiaRenderer, graph: SceneGraph, spine: SceneNode) {
  const path = shapeBuilderSourcePath(r, spine, graph)
  if (!path) return null
  const iter = new r.ck.ContourMeasureIter(path, false, 1)
  const contour = iter.next()
  iter.delete()
  path.delete()
  if (!contour) return null
  const length = contour.length()
  return {
    length,
    at: (t: number): Vector => {
      const [x, y] = contour.getPosTan(Math.max(0, Math.min(1, t)) * length)
      return { x, y }
    },
    dispose: () => contour.delete()
  }
}

/** How many steps a blend makes over `length`, by its spacing. */
function stepCount(spacing: BlendSpacing, length: number): number {
  if (spacing.spacing === 'steps') return spacing.steps
  const count = Math.round(length / Math.max(1, spacing.distance)) - 1
  return Math.max(1, Math.min(MAX_BLEND_STEPS, count))
}

function distanceBetween(a: Vector, b: Vector) {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

/**
 * Makes a live blend's steps again between its ends, along its spine when it has one, and keeps
 * the steps' ids in the group's blend. Returns the new steps' ids, or null when the ends can no
 * longer be blended.
 */
export function regenerateBlend(
  r: SkiaRenderer,
  graph: SceneGraph,
  group: SceneNode,
  blend: LiveBlend,
  fit: GroupFitOptions
): string[] | null {
  const from = graph.getNode(blend.fromId)
  const to = graph.getNode(blend.toId)
  if (!from || !to) return null
  const spineNode = blend.spineId ? graph.getNode(blend.spineId) : undefined
  const spine = spineNode?.parentId === group.id ? measureSpine(r, graph, spineNode) : null
  try {
    const a = outlineCentre(r, graph, from)
    const b = outlineCentre(r, graph, to)
    if (!a || !b) return null
    const count = stepCount(blend, spine?.length ?? distanceBetween(a, b))
    const props = blendStepProps(r, graph, from, to, count, spine?.at)
    if (!props) return null
    for (const id of blend.stepIds)
      if (graph.getNode(id)?.parentId === group.id) graph.deleteNode(id)
    const current = graph.getNode(group.id)
    if (!current) return null
    // Steps stack from the first end up to the second, between them.
    const fromIndex = current.childIds.indexOf(from.id)
    const toIndex = current.childIds.indexOf(to.id)
    const low = Math.min(fromIndex, toIndex)
    const ordered = fromIndex < toIndex ? props : props.toReversed()
    const stepIds = ordered.map((stepProps, i) => {
      const step = graph.createNode('VECTOR', group.id, stepProps)
      graph.insertChildAt(step.id, group.id, low + 1 + i)
      return step.id
    })
    const next: LiveBlend = { ...blend, stepIds, steps: count }
    graph.updateNode(group.id, {
      pluginData: withPluginData(current.pluginData, LAWHA_PLUGIN_DATA.liveBlend, next)
    })
    fitEnclosingGroups(graph, [group.id], fit)
    return stepIds
  } finally {
    spine?.dispose()
  }
}

/**
 * Illustrator's Blend → Make: a group named "Blend" of the two ends with the steps between them,
 * kept live so its spacing and spine can change. Null when the ends cannot be blended.
 */
export function makeLiveBlend(
  r: SkiaRenderer,
  graph: SceneGraph,
  from: SceneNode,
  to: SceneNode,
  spacing: BlendSpacing,
  fit: GroupFitOptions
): { group: SceneNode; stepIds: string[] } | null {
  const parentId = from.parentId
  const parent = parentId ? graph.getNode(parentId) : undefined
  if (!parentId || !parent || to.parentId !== parentId) return null
  if (!canTakePathEffect(from, graph) || !canTakePathEffect(to, graph)) return null
  const index = Math.min(parent.childIds.indexOf(from.id), parent.childIds.indexOf(to.id))
  const group = wrapNodes(graph, 'GROUP', [from, to], parentId, index, { name: 'Blend' })
  const blend: LiveBlend = { fromId: from.id, toId: to.id, stepIds: [], ...spacing }
  const stepIds = regenerateBlend(r, graph, group, blend, fit)
  if (!stepIds) {
    ungroupNode(graph, group.id)
    return null
  }
  return { group: graph.getNode(group.id) ?? group, stepIds }
}

/**
 * Illustrator's Blend → Replace Spine: `spine`, an open or closed path, becomes the line the
 * steps follow. It moves into the blend and stops drawing; the ends move to its start and end,
 * and a spine the blend had before goes back beside the blend, drawing again.
 */
export function replaceBlendSpine(
  r: SkiaRenderer,
  graph: SceneGraph,
  group: SceneNode,
  blend: LiveBlend,
  spine: SceneNode,
  fit: GroupFitOptions
): string[] | null {
  if (spine.id === blend.fromId || spine.id === blend.toId) return null
  if (!canTakePathEffect(spine, graph) || !group.parentId) return null
  const old = blend.spineId ? graph.getNode(blend.spineId) : undefined
  if (old && old.id !== spine.id && old.parentId === group.id) {
    graph.updateNode(old.id, { visible: true })
    graph.reparentNode(old.id, group.parentId)
  }
  if (spine.parentId !== group.id) graph.reparentNode(spine.id, group.id)
  graph.updateNode(spine.id, { visible: false })
  const placed = graph.getNode(spine.id)
  const measured = placed ? measureSpine(r, graph, placed) : null
  if (!measured) return null
  try {
    for (const [id, t] of [
      [blend.fromId, 0],
      [blend.toId, 1]
    ] as const) {
      const end = graph.getNode(id)
      const centre = end && outlineCentre(r, graph, end)
      if (!end || !centre) continue
      const target = measured.at(t)
      graph.updateNode(id, { x: end.x + target.x - centre.x, y: end.y + target.y - centre.y })
    }
  } finally {
    measured.dispose()
  }
  const current = graph.getNode(group.id)
  if (!current) return null
  return regenerateBlend(r, graph, current, { ...blend, spineId: spine.id }, fit)
}

/**
 * Illustrator's Blend → Release: the steps go, the spine draws again, and the ends and spine
 * leave the group. Returns the layers left.
 */
export function releaseLiveBlend(
  graph: SceneGraph,
  group: SceneNode,
  blend: LiveBlend
): string[] | null {
  for (const id of blend.stepIds) if (graph.getNode(id)?.parentId === group.id) graph.deleteNode(id)
  if (blend.spineId && graph.getNode(blend.spineId)?.parentId === group.id)
    graph.updateNode(blend.spineId, { visible: true })
  return ungroupNode(graph, group.id)
}

/**
 * Illustrator's Blend → Expand: the steps stay as ordinary vectors in the group, the spine goes,
 * and the group stops being a live blend.
 */
export function expandLiveBlend(graph: SceneGraph, group: SceneNode, blend: LiveBlend): void {
  if (blend.spineId && graph.getNode(blend.spineId)?.parentId === group.id)
    graph.deleteNode(blend.spineId)
  const current = graph.getNode(group.id)
  if (!current) return
  graph.updateNode(group.id, {
    pluginData: withPluginData(current.pluginData, LAWHA_PLUGIN_DATA.liveBlend, undefined)
  })
}
