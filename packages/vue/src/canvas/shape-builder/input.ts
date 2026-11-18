import type { Editor } from '@lawha/core'
import type { Vector } from '@lawha/scene-graph/primitives'

import type { DragState } from '#vue/shared/input/types'

/** How the Shape Builder treats what the pointer crosses: Alt deletes, as in Illustrator. */
function modeOf(event: MouseEvent) {
  return event.altKey ? 'delete' : 'merge'
}

/** Shades the region of the selected shapes under the pointer while no drag is held. */
export function hoverShapeBuilder(event: MouseEvent, cx: number, cy: number, editor: Editor) {
  editor.setShapeBuilderHover([{ x: cx, y: cy }], modeOf(event))
}

/**
 * Starts a Shape Builder drag over the selected shapes: every region the pointer crosses is
 * shaded, and the release merges them, or deletes them when Alt was held at the press. Returns
 * false when the press is on no region, so the canvas can select instead.
 */
export function startShapeBuilderDrag(
  event: MouseEvent,
  cx: number,
  cy: number,
  editor: Editor,
  setDrag: (d: DragState) => void
): boolean {
  const mode = modeOf(event)
  const points: Vector[] = [{ x: cx, y: cy }]
  editor.setShapeBuilderHover(points, mode)
  if (!editor.state.shapeBuilderHover) return false
  setDrag({
    type: 'shape-builder',
    move: (x, y) => {
      points.push({ x, y })
      editor.setShapeBuilderHover(points, mode)
    },
    commit: () => {
      editor.shapeBuilderSelected(points, mode)
    },
    cancel: () => editor.setShapeBuilderHover(null)
  })
  return true
}
