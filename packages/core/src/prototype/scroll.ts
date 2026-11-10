import * as v from 'valibot'

import type { SceneGraph, SceneNode } from '@lawha/scene-graph'
import { getAbsolutePosition } from '@lawha/scene-graph/coordinate'
import type { Rect } from '@lawha/scene-graph/primitives'

import { getPluginData } from '#core/figma-api/plugin-data'
import { extractPageContext, findPageId } from '#core/io/subgraph'

import { scrollDirectionSchema } from './schema'

export type ScrollDirection = v.InferOutput<typeof scrollDirectionSchema>

/** Plugin-data key of a frame's scroll direction in the prototype. */
export const SCROLL_KEY = 'prototype.scroll'

/** A frame's scroll direction; `none` when unset or malformed. */
export function readScroll(node: SceneNode): ScrollDirection {
  const parsed = v.safeParse(scrollDirectionSchema, getPluginData(node, SCROLL_KEY))
  return parsed.success ? parsed.output : 'none'
}

/** A frame whose content scrolls in the player, placed on its screen. */
export interface ScrollRegion extends Rect {
  node: string
  direction: Exclude<ScrollDirection, 'none'>
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

/**
 * The frames inside a screen that scroll, outermost only: a scrolling frame inside another
 * scrolls with its parent's content. A frame scrolls when it is set to and clips its content.
 */
export function scrollRegions(graph: SceneGraph, screenId: string): ScrollRegion[] {
  const screen = graph.getNode(screenId)
  if (!screen) return []
  const origin = getAbsolutePosition(screen, graph)
  const out: ScrollRegion[] = []
  const walk = (id: string) => {
    const node = graph.getNode(id)
    if (!node || !node.visible) return
    const direction =
      node.type === 'FRAME' || node.type === 'COMPONENT' || node.type === 'INSTANCE'
        ? readScroll(node)
        : 'none'
    if (direction !== 'none' && node.clipsContent) {
      const at = getAbsolutePosition(node, graph)
      const extent = contentExtent(graph, node)
      out.push({
        node: node.id,
        direction,
        x: at.x - origin.x,
        y: at.y - origin.y,
        width: node.width,
        height: node.height,
        contentWidth: extent.width,
        contentHeight: extent.height
      })
      return
    }
    node.childIds.forEach(walk)
  }
  screen.childIds.forEach(walk)
  return out
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
  region: ScrollRegion
): { graph: SceneGraph; pageId: string } | null {
  const pageId = findPageId(graph, region.node)
  if (!pageId) return null
  const copy = extractPageContext(graph, pageId, [region.node])
  copy.updateNode(region.node, { width: region.contentWidth, height: region.contentHeight })
  return { graph: copy, pageId }
}
