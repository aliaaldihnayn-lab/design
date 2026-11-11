import type { SceneGraph, SceneNode } from '@lawha/scene-graph'
import { findLayerByPath, layerPath } from '@lawha/scene-graph/behaviours'
import { copyEffects, copyFills, copyStrokes } from '@lawha/scene-graph/copy'

/**
 * Restyling a kit component drawn earlier: its layers take the look a fresh drawing in the
 * current tokens gives them, matched by their path of names, while keeping their ids, text,
 * interactions, and variables, so every instance and override keeps working.
 */

/** The fields that make a layer's look, which a restyle copies. */
const LOOK_FIELDS = [
  'opacity',
  'strokeWeight',
  'strokeAlign',
  'cornerRadius',
  'topLeftRadius',
  'topRightRadius',
  'bottomLeftRadius',
  'bottomRightRadius',
  'independentCorners',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'italic',
  'fontStyle',
  'lineHeight',
  'letterSpacing'
] as const satisfies readonly (keyof SceneNode)[]

/** Bound fields that belong to the look: paints and effects, such as `fills/0/color`. */
const LOOK_BINDING = /^(fills|strokes|effects)(\/|$)/

function lookOf(fresh: SceneNode, current: SceneNode): Partial<SceneNode> {
  const changes: Partial<SceneNode> = {
    fills: copyFills(fresh.fills),
    strokes: copyStrokes(fresh.strokes),
    effects: copyEffects(fresh.effects)
  }
  for (const field of LOOK_FIELDS)
    Object.assign(changes, { [field]: structuredClone(fresh[field]) })
  const kept = Object.entries(current.boundVariables).filter(([key]) => !LOOK_BINDING.test(key))
  const bound = Object.entries(fresh.boundVariables).filter(([key]) => LOOK_BINDING.test(key))
  changes.boundVariables = Object.fromEntries([...kept, ...bound])
  return changes
}

export interface RestyleResult {
  /** Layers that took the fresh look. */
  restyled: number
  /** Layers of the drawing in place that the fresh one no longer has, left as they were. */
  unmatched: number
}

/**
 * Gives the layers below `current` the look of the same layers below `fresh`, a component or
 * set drawn again in the current tokens, then syncs the instances of every variant.
 */
export function restyleComponent(
  graph: SceneGraph,
  current: SceneNode,
  fresh: SceneNode
): RestyleResult {
  const result: RestyleResult = { restyled: 0, unmatched: 0 }
  const walk = (node: SceneNode) => {
    const path = layerPath(graph, current.id, node.id)
    const match = findLayerByPath(graph, fresh.id, path)
    if (match && match.type === node.type) {
      graph.updateNode(node.id, lookOf(match, node))
      result.restyled++
    } else result.unmatched++
    for (const child of graph.getChildren(node.id)) walk(child)
  }
  walk(current)
  const variants =
    current.type === 'COMPONENT_SET'
      ? graph.getChildren(current.id).map((child) => child.id)
      : [current.id]
  graph.syncInstancesTogether(variants)
  return result
}
