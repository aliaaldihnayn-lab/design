import type { LayoutDirection, SceneNode, TextDirection } from '@lawha/scene-graph'
import { detectTextDirection } from '@lawha/scene-graph/text/direction'

import type { DesignStyleDeclaration, DocumentDirection } from '../types'
import { pickStyle } from './css-values'

export type FlowDirection = Exclude<LayoutDirection, 'AUTO'>

/** A `dir` attribute's direction; `auto` and anything else leave it to the parent. */
export function directionFromAttribute(value: string | undefined): DocumentDirection | undefined {
  const dir = value?.trim().toLowerCase()
  return dir === 'rtl' || dir === 'ltr' ? dir : undefined
}

/** The direction CSS gives an element: its `direction`, or the one it inherits. */
export function cssDirection(
  style: DesignStyleDeclaration,
  inherited: FlowDirection = 'LTR'
): FlowDirection {
  const direction = pickStyle(style, 'direction')?.trim().toLowerCase()
  if (direction === 'rtl') return 'RTL'
  if (direction === 'ltr') return 'LTR'
  return inherited
}

/**
 * A frame lays its content out in its CSS direction. It says so only where that differs from
 * its parent's, since a frame takes its parent's direction (`resolveNodeLayoutDirection`).
 */
export function applyLayoutDirection(
  node: SceneNode,
  direction: FlowDirection,
  parentDirection: FlowDirection
): void {
  if (direction !== parentDirection) node.layoutDirection = direction
}

/**
 * Text keeps the base direction CSS gives it. Left to detect it, a text would take the direction
 * of its first letter, so it says its own only where that would differ.
 */
export function applyTextDirection(node: SceneNode, direction: FlowDirection): void {
  const text: TextDirection = direction
  if (detectTextDirection(node.text) !== direction) node.textDirection = text
}

/** `text-align` as a text's horizontal alignment: `start` and `end` follow its direction. */
export function textAlignFromCSS(
  value: string | undefined,
  direction: FlowDirection
): SceneNode['textAlignHorizontal'] {
  const align = value?.trim().toLowerCase()
  if (align === 'center') return 'CENTER'
  if (align === 'justify') return 'JUSTIFIED'
  if (align === 'left' || align === 'right') return align === 'left' ? 'LEFT' : 'RIGHT'
  const end = align === 'end'
  return (direction === 'RTL') !== end ? 'RIGHT' : 'LEFT'
}

/**
 * `text-align` as where a line of inline content sits on its frame's axis, which runs from the
 * frame's start: the right in right-to-left content.
 */
export function inlineAlignFromCSS(
  value: string | undefined,
  direction: FlowDirection
): 'MIN' | 'CENTER' | 'MAX' | null {
  const align = value?.trim().toLowerCase()
  if (!align) return null
  if (align === 'center') return 'CENTER'
  if (align === 'left' || align === 'right') {
    return (align === 'right') !== (direction === 'RTL') ? 'MAX' : 'MIN'
  }
  return align === 'end' ? 'MAX' : 'MIN'
}
