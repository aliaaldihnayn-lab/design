import type { Node as YogaNode } from 'yoga-layout'

import type { SceneGraph, SceneNode } from '@lawha/scene-graph'
import { getNodeWorldBounds } from '@lawha/scene-graph/coordinate'
import type { Rect } from '@lawha/scene-graph/primitives'

import { keepsSavedLayout } from './derived'
import { mapAlignSelf } from './yoga-helpers'

const FULL_TURN = 360
const EPSILON = 1e-6

function isTurned(rotation: number): boolean {
  const turn = ((rotation % FULL_TURN) + FULL_TURN) % FULL_TURN
  return turn > EPSILON && FULL_TURN - turn > EPSILON
}

/**
 * Whether auto layout places `child` by the box it draws, as Figma lays out a turned layer: its
 * bounding box takes its place in the flow, and the layer keeps its own width and height. A turned
 * layer a .fig file placed keeps the place the file saved, while its frame keeps that layout.
 */
export function laysOutTurned(graph: SceneGraph, frame: SceneNode, child: SceneNode): boolean {
  if (!child.visible || child.layoutPositioning === 'ABSOLUTE' || !isTurned(child.rotation))
    return false
  return !(child.source.format === 'fig' && keepsSavedLayout(graph, frame))
}

/** The box a turned layer draws in its parent when placed at the parent's origin. */
export function turnedBox(child: SceneNode): Rect {
  return getNodeWorldBounds({ ...child, x: 0, y: 0 })
}

/** A turned layer takes its bounding box's size in the flow, neither growing nor shrinking. */
export function configureTurnedChild(yogaChild: YogaNode, child: SceneNode): void {
  const box = turnedBox(child)
  yogaChild.setWidth(box.width)
  yogaChild.setHeight(box.height)
  yogaChild.setFlexGrow(0)
  yogaChild.setFlexShrink(0)
  const selfAlign = mapAlignSelf(child.layoutAlignSelf)
  if (selfAlign != null) yogaChild.setAlignSelf(selfAlign)
}

/** Where a turned layer sits once auto layout put its bounding box at the computed place. */
export function turnedPosition(child: SceneNode, yogaChild: YogaNode): Pick<SceneNode, 'x' | 'y'> {
  const box = turnedBox(child)
  return { x: yogaChild.getComputedLeft() - box.x, y: yogaChild.getComputedTop() - box.y }
}
