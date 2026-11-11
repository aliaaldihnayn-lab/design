import type { Editor } from '@lawha/core'

import type { createGuideInput } from '#vue/canvas/guides/input'
import { selectedTopLevelGuideFrameId } from '#vue/canvas/guides/input'
import { handlePenDragMove } from '#vue/canvas/pen/input'
import { handlePencilDragMove } from '#vue/canvas/pencil/input'
import type { createCanvasTransformInput } from '#vue/canvas/transform/input'
import { handleBendHandleMove } from '#vue/canvas/vector-input/input'
import { attachModifiers, handleConnectorDrawMove } from '#vue/shared/input/connector/draw'
import { handleDrawMove } from '#vue/shared/input/draw'
import { handleMoveMove } from '#vue/shared/input/move/drag'
import { applyResize } from '#vue/shared/input/resize'
import { applyStickyScale } from '#vue/shared/input/sticky/scale'
import type { DragState } from '#vue/shared/input/types'
import { handleNodeEditMarqueeMove, handleNodeEditMove } from '#vue/shared/input/vector'

/** What moving a held drag needs from the canvas input that owns it. */
export interface DragMoveContext {
  editor: Editor
  guideInput: ReturnType<typeof createGuideInput>
  transform: ReturnType<typeof createCanvasTransformInput>
  spaceHeld: () => boolean
}

/** Pointer coordinates in canvas (`cx`, `cy`) and screen (`sx`, `sy`) space. */
export interface DragPointer {
  cx: number
  cy: number
  sx: number
  sy: number
}

/**
 * Moves the drag held on the canvas to the pointer, by its kind. Dispatching the whole drag
 * union is kept in one place, so a new kind is one case here.
 */
// eslint-disable-next-line complexity
export function moveDrag(d: DragState, e: MouseEvent, at: DragPointer, ctx: DragMoveContext) {
  const { editor, guideInput, transform } = ctx
  const { sx, sy, cx, cy } = at

  if (d.type === 'pan') {
    transform.handlePanMove(d, e)
    return
  }
  if (d.type === 'gradient' || d.type === 'shape-handle') {
    d.update(sx, sy, e.shiftKey)
    return
  }
  if (d.type === 'guide') {
    const frameId = e.altKey && !d.guideId ? selectedTopLevelGuideFrameId(editor) : null
    guideInput.handleMove(
      d,
      sx,
      sy,
      cx,
      cy,
      frameId ? { frameId, deep: e.metaKey || e.ctrlKey } : undefined
    )
    return
  }
  if (d.type === 'rotate') {
    transform.handleRotateMove(d, cx, cy, e.shiftKey)
    return
  }
  if (d.type === 'move') {
    handleMoveMove(d, cx, cy, sx, sy, editor, { ctrlKey: e.ctrlKey, shiftKey: e.shiftKey })
    return
  }
  if (d.type === 'text-select') {
    transform.handleTextSelectMove(cx, cy)
    return
  }
  if (d.type === 'resize') {
    applyResize(d, cx, cy, e.shiftKey, editor, e.ctrlKey)
    return
  }
  if (d.type === 'pen-drag') {
    handlePenDragMove(d, cx, cy, ctx.spaceHeld(), e, editor)
    return
  }
  if (d.type === 'pencil-drag') {
    handlePencilDragMove(cx, cy, e.shiftKey, editor)
    return
  }
  if (d.type === 'edit-node' || d.type === 'edit-handle') {
    handleNodeEditMove(d, cx, cy, editor, e.altKey, e.metaKey || e.ctrlKey, e.shiftKey, e.ctrlKey)
    return
  }
  if (d.type === 'bend-handle') {
    handleBendHandleMove(d, cx, cy, e, editor)
    return
  }
  if (d.type === 'edit-marquee') {
    handleNodeEditMarqueeMove(d, cx, cy, editor)
    return
  }
  if (d.type === 'draw') {
    handleDrawMove(d, cx, cy, e.shiftKey)
    return
  }
  if (d.type === 'sticky-draw' || d.type === 'shape-builder' || d.type === 'live-effect') {
    d.move(cx, cy)
    return
  }
  if (d.type === 'pixel') {
    d.move(cx, cy, e.shiftKey)
    return
  }
  if (d.type === 'connector-draw') {
    handleConnectorDrawMove(d, cx, cy, sx, sy, editor, attachModifiers(e))
    return
  }
  if (d.type === 'connector-end') {
    editor.connectorEndpointDrag(cx, cy, attachModifiers(e))
    return
  }
  if (d.type === 'connector-line') {
    editor.connectorLineDrag(cx, cy)
    return
  }
  if (d.type === 'line-end') {
    editor.lineEndDrag(cx, cy, { shift: e.shiftKey, alt: e.altKey })
    return
  }
  if (d.type === 'sticky-scale') {
    applyStickyScale(d, cx, cy, editor, e.ctrlKey)
    return
  }
  transform.handleMarqueeMove(d, cx, cy)
}
