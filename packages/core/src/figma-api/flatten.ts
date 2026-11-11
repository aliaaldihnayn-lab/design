import type { SceneGraph, SceneNode } from '@lawha/scene-graph'
import { copyFills } from '@lawha/scene-graph/copy'

import type { SkiaRenderer } from '#core/canvas'
import { canMakeBooleanSourceNode } from '#core/canvas/boolean'
import { flattenNodesToVectorProps } from '#core/canvas/flatten'

/** Without a renderer there are no outlines to merge: the first layer's box stands in. */
function flattenPlaceholder(graph: SceneGraph, nodes: SceneNode[], parentId: string): SceneNode {
  const first = nodes[0]
  return graph.createNode('VECTOR', parentId, {
    name: 'Flatten',
    x: first.x,
    y: first.y,
    width: first.width,
    height: first.height,
    fills: copyFills(first.fills)
  })
}

/** The vector `flatten` makes from `nodes` in `parentId`, before the sources are removed. */
export function flattenSceneNodes(
  graph: SceneGraph,
  renderer: SkiaRenderer | null,
  nodes: SceneNode[],
  parentId: string
): SceneNode {
  if (!renderer) return flattenPlaceholder(graph, nodes, parentId)
  if (nodes.some((node) => !canMakeBooleanSourceNode(node, graph))) {
    throw new Error('Cannot flatten unsupported node type')
  }
  const vectorProps = flattenNodesToVectorProps(renderer, graph, nodes)
  if (!vectorProps) throw new Error('Cannot flatten empty node path')
  return graph.createNode('VECTOR', parentId, vectorProps)
}

/**
 * Figma's `figma.flatten`: one vector of `nodes` in `parentId`, at `index` when given, with the
 * sources removed.
 */
export function flattenIntoVector(
  graph: SceneGraph,
  renderer: SkiaRenderer | null,
  nodeIds: readonly string[],
  parentId: string,
  index?: number
): SceneNode {
  if (nodeIds.length === 0) throw new Error('Need at least 1 node to flatten')
  const sourceNodes: SceneNode[] = []
  for (const id of nodeIds) {
    const raw = graph.getNode(id)
    if (!raw) throw new Error('Node not found')
    sourceNodes.push(raw)
  }
  const vector = flattenSceneNodes(graph, renderer, sourceNodes, parentId)
  if (index != null) graph.insertChildAt(vector.id, parentId, index)
  for (const id of nodeIds) graph.deleteNode(id)
  return vector
}
