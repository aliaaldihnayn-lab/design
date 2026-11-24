import type { SceneGraph, SceneNode } from '@lawha/scene-graph'
import { isGeneratedFrame, layerResizes } from '@lawha/scene-graph/generated'
import { readIcon } from '@lawha/scene-graph/icons'
import { hasPluginData, LAWHA_PLUGIN_DATA } from '@lawha/scene-graph/plugin-data'

import type { PanelSelection } from './tabs'

/** Layers with an outline Illustrator's path effects reshape. */
const PATH_EFFECT_TYPES = new Set([
  'RECTANGLE',
  'ROUNDED_RECTANGLE',
  'ELLIPSE',
  'POLYGON',
  'STAR',
  'LINE',
  'VECTOR',
  'TEXT',
  'BOOLEAN_OPERATION'
])
const LAYOUT_GUIDE_TYPES = new Set(['FRAME', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE'])

/** Whether a layer takes path effects; a live blend's group does too, for its blend options. */
export function takesPathEffects(node: SceneNode): boolean {
  return (
    PATH_EFFECT_TYPES.has(node.type) || hasPluginData(node.pluginData, LAWHA_PLUGIN_DATA.liveBlend)
  )
}

/** Figma offers layout guides while every selected layer is a frame. */
export function holdsLayoutGuides(nodes: readonly SceneNode[]): boolean {
  return nodes.length > 0 && nodes.every((node) => LAYOUT_GUIDE_TYPES.has(node.type))
}

/**
 * Sticky notes, shapes, and connectors keep FigJam's fixed choices, which their own sections
 * offer, so a selection holding one offers no free-form appearance, type, fill, stroke, or effects.
 */
export function stylesFreely(nodes: readonly SceneNode[]): boolean {
  return nodes.every((node) => !isGeneratedFrame(node))
}

/** What the properties panel needs to know of a selection to choose its tabs and sections. */
export function describePanelSelection(
  graph: Pick<SceneGraph, 'getNode'>,
  nodes: readonly SceneNode[],
  frameTool: boolean
): PanelSelection {
  const node = nodes.length === 1 ? nodes[0] : undefined
  const parent = node?.parentId ? graph.getNode(node.parentId) : undefined
  let kind: PanelSelection['kind'] = 'none'
  if (nodes.length > 1) kind = 'multi'
  else if (node) kind = 'single'
  return {
    kind,
    frameTool,
    type: node?.type,
    inComponentSet: parent?.type === 'COMPONENT_SET',
    icon: !!node && !!readIcon(node),
    resizes: !!node && layerResizes(node),
    freeStyle: stylesFreely(nodes),
    pathEffects: nodes.length > 0 && nodes.every(takesPathEffects),
    layoutGuides: holdsLayoutGuides(nodes)
  }
}
