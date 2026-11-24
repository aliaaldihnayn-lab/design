import { pick } from 'es-toolkit'

import type { SceneGraph, SceneNode, TextAutoResize } from '@lawha/scene-graph'
import { layoutSizing, layoutSizingUpdates, type LayoutSizingAxis } from '@lawha/scene-graph/layout'
import type { Rect } from '@lawha/scene-graph/primitives'

const SIZING_FIELDS = [
  'primaryAxisSizing',
  'counterAxisSizing',
  'layoutGrow',
  'layoutAlignSelf'
] as const satisfies readonly (keyof SceneNode)[]

export type LayerSizing = Pick<SceneNode, (typeof SIZING_FIELDS)[number]>

const AXES: readonly ['width' | 'height', LayoutSizingAxis][] = [
  ['width', 'HORIZONTAL'],
  ['height', 'VERTICAL']
]

export function layerSizing(node: SceneNode): LayerSizing {
  return pick(node, SIZING_FIELDS)
}

/**
 * The sizing a handle drag leaves the layer with, as Figma sets it: an axis the drag resized stops
 * hugging or filling and becomes fixed, so layout keeps the dragged size, while an axis it left
 * alone keeps its sizing. Text hugs by its auto-resize, which a drag sets elsewhere.
 */
export function draggedSizing(
  graph: SceneGraph,
  node: SceneNode,
  original: LayerSizing,
  origRect: Rect,
  rect: Rect
): LayerSizing {
  const sizing = { ...original }
  if (node.type === 'TEXT') return sizing
  const base = { ...node, ...original }
  for (const [dimension, axis] of AXES) {
    if (rect[dimension] === origRect[dimension]) continue
    if (layoutSizing(graph, base, axis) === 'FIXED') continue
    Object.assign(sizing, pick(layoutSizingUpdates(graph, base, axis, 'FIXED'), SIZING_FIELDS))
  }
  return sizing
}

/**
 * The auto-resize a handle drag leaves text with, as Figma sets it: text that sized its width
 * wraps at the dragged width and keeps sizing its height, and text whose height was dragged keeps
 * the box it was given.
 */
export function draggedTextAutoResize(
  mode: TextAutoResize,
  origRect: Rect,
  rect: Rect
): TextAutoResize {
  const sizesHeight = mode === 'WIDTH_AND_HEIGHT' || mode === 'HEIGHT'
  if (sizesHeight && rect.height !== origRect.height) return 'NONE'
  if (mode === 'WIDTH_AND_HEIGHT' && rect.width !== origRect.width) return 'HEIGHT'
  return mode
}
