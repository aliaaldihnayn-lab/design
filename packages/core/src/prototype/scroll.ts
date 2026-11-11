import * as v from 'valibot'

import type { SceneGraph, SceneNode } from '@lawha/scene-graph'
import { getAbsolutePosition } from '@lawha/scene-graph/coordinate'
import type { Rect } from '@lawha/scene-graph/primitives'

import { getPluginData } from '#core/figma-api/plugin-data'
import { extractPageContext, findPageId } from '#core/io/subgraph'

import { scrollDirectionSchema, scrollPositionSchema } from './schema'

export type ScrollDirection = v.InferOutput<typeof scrollDirectionSchema>
export type ScrollPosition = v.InferOutput<typeof scrollPositionSchema>

/** Plugin-data key of a layer's behaviour while its frame scrolls. */
export const POSITION_KEY = 'prototype.position'

/** A layer's scroll behaviour; `scrolls` when unset or malformed. */
export function readPosition(node: SceneNode): ScrollPosition {
  const parsed = v.safeParse(scrollPositionSchema, getPluginData(node, POSITION_KEY))
  return parsed.success ? parsed.output : 'scrolls'
}

/** A child of a scrolling frame that stays fixed or sticks while the frame scrolls. */
export interface PinnedLayer extends Rect {
  node: string
  mode: 'fixed' | 'sticky'
}

/** Plugin-data key of a frame's scroll direction in the prototype. */
export const SCROLL_KEY = 'prototype.scroll'

/** A frame's scroll direction; `none` when unset or malformed. */
export function readScroll(node: SceneNode): ScrollDirection {
  const parsed = v.safeParse(scrollDirectionSchema, getPluginData(node, SCROLL_KEY))
  return parsed.success ? parsed.output : 'none'
}

/**
 * A frame whose content scrolls in the player. It is placed on its screen, or, inside another
 * scrolling frame, in that frame's content, and scrolls on its own.
 */
export interface ScrollRegion extends Rect {
  node: string
  direction: Exclude<ScrollDirection, 'none'>
  /** The scrolling frame it is inside, whose content carries it; null on the screen itself. */
  parent: string | null
  /** Its direct children that stay put (fixed) or stick at its top (sticky), in its own box. */
  pinned: PinnedLayer[]
  /** The extent of the frame's content from its top left, at least the frame's own size. */
  contentWidth: number
  contentHeight: number
}

/** How far a frame's children reach from its top left, at least the frame itself. */
export function contentExtent(
  graph: SceneGraph,
  frame: SceneNode
): { width: number; height: number } {
  let width = frame.width
  let height = frame.height
  for (const id of frame.childIds) {
    const child = graph.getNode(id)
    if (!child || !child.visible) continue
    width = Math.max(width, child.x + child.width)
    height = Math.max(height, child.y + child.height)
  }
  return { width, height }
}

function isScrollable(node: SceneNode): boolean {
  return node.type === 'FRAME' || node.type === 'COMPONENT' || node.type === 'INSTANCE'
}

/**
 * The frames inside a screen that scroll, outer ones first. A frame scrolls when it is set to
 * and clips its content; one inside another scrolls on its own, carried by its parent's
 * content, as nested scrolling frames do in Figma.
 */
export function scrollRegions(graph: SceneGraph, screenId: string): ScrollRegion[] {
  const screen = graph.getNode(screenId)
  if (!screen) return []
  const out: ScrollRegion[] = []
  const walk = (id: string, parent: SceneNode, parentRegion: string | null) => {
    const node = graph.getNode(id)
    if (!node || !node.visible) return
    const direction = isScrollable(node) ? readScroll(node) : 'none'
    if (direction === 'none' || !node.clipsContent) {
      for (const child of node.childIds) walk(child, parent, parentRegion)
      return
    }
    const at = getAbsolutePosition(node, graph)
    const origin = getAbsolutePosition(parent, graph)
    const extent = contentExtent(graph, node)
    const pinned: PinnedLayer[] = []
    for (const childId of node.childIds) {
      const child = graph.getNode(childId)
      const mode = child?.visible ? readPosition(child) : 'scrolls'
      if (child && mode !== 'scrolls')
        pinned.push({
          node: child.id,
          mode,
          x: child.x,
          y: child.y,
          width: child.width,
          height: child.height
        })
    }
    out.push({
      node: node.id,
      direction,
      parent: parentRegion,
      pinned,
      x: at.x - origin.x,
      y: at.y - origin.y,
      width: node.width,
      height: node.height,
      contentWidth: extent.width,
      contentHeight: extent.height
    })
    for (const child of node.childIds)
      if (!pinned.some((layer) => layer.node === child)) walk(child, node, node.id)
  }
  for (const child of screen.childIds) walk(child, screen, null)
  return out
}

/** The pinned layer of a region that `nodeId` is, or is inside; null when it scrolls. */
export function pinnedLayerOf(
  graph: SceneGraph,
  region: ScrollRegion,
  nodeId: string
): PinnedLayer | null {
  const byNode = new Map(region.pinned.map((layer) => [layer.node, layer]))
  let node = graph.getNode(nodeId)
  while (node) {
    const found = byNode.get(node.id)
    if (found) return found
    node = node.parentId ? graph.getNode(node.parentId) : undefined
  }
  return null
}

/** The region a layer scrolls with, and where it sits in that region's content. */
export function scrollTarget(
  graph: SceneGraph,
  regions: readonly ScrollRegion[],
  nodeId: string
): { region: ScrollRegion; x: number; y: number } | null {
  let node = graph.getNode(nodeId)
  const target = node
  while (node?.parentId) {
    const parentId = node.parentId
    const region = regions.find((r) => r.node === parentId)
    if (region && target) {
      const frame = graph.getNode(parentId)
      if (!frame) return null
      const at = getAbsolutePosition(target, graph)
      const origin = getAbsolutePosition(frame, graph)
      return { region, x: at.x - origin.x, y: at.y - origin.y }
    }
    node = graph.getNode(parentId)
  }
  return null
}

/**
 * A private copy of a scrolling frame's page, the frame grown to hold all its content, for
 * drawing the content the player scrolls.
 */
export function scrollContentGraph(
  graph: SceneGraph,
  region: ScrollRegion,
  regions: readonly ScrollRegion[] = []
): { graph: SceneGraph; pageId: string } | null {
  const pageId = findPageId(graph, region.node)
  if (!pageId) return null
  const copy = extractPageContext(graph, pageId, [region.node])
  copy.updateNode(region.node, { width: region.contentWidth, height: region.contentHeight })
  // Pinned layers and the content of nested scrolling frames are drawn apart.
  const hidden = [
    ...region.pinned.map((layer) => layer.node),
    ...regions
      .filter((other) => other.parent === region.node)
      .flatMap((other) => graph.getNode(other.node)?.childIds ?? [])
  ]
  for (const id of hidden) if (copy.getNode(id)) copy.updateNode(id, { visible: false })
  return { graph: copy, pageId }
}

/** A private copy of a pinned layer's page, for drawing it on its own. */
export function pinnedLayerGraph(
  graph: SceneGraph,
  layer: PinnedLayer
): { graph: SceneGraph; pageId: string } | null {
  const pageId = findPageId(graph, layer.node)
  if (!pageId) return null
  return { graph: extractPageContext(graph, pageId, [layer.node]), pageId }
}
