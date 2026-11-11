import type { SceneGraph, SceneNode } from '@lawha/scene-graph'
import type { GroupFitOptions } from '@lawha/scene-graph/group-bounds'

import { booleanOperationPaints, createBooleanOperation } from '#core/editor/structure/boolean'

export type FigmaBooleanOperation = 'UNION' | 'SUBTRACT' | 'INTERSECT' | 'EXCLUDE'

/**
 * Figma's `figma.union`, `subtract`, `intersect`, and `exclude`: the editor's boolean command
 * over `members` in `parentId`, painted as a script's boolean is.
 */
export function scriptBooleanOperation(
  graph: SceneGraph,
  operation: FigmaBooleanOperation,
  members: SceneNode[],
  parentId: string,
  index: number | undefined,
  fit: GroupFitOptions
): SceneNode {
  const paints = booleanOperationPaints(operation, members, 'script')
  return createBooleanOperation(graph, members, parentId, operation, index, paints, fit).node
}
