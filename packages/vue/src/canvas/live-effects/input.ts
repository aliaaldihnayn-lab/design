import type { Editor } from '@lawha/core'

import type { CanvasTool, CanvasToolPointer } from '#vue/canvas/tools/registry'
import type { DragState } from '#vue/shared/input/types'

/**
 * Starts dragging the live effect handle under the pointer, a mesh point or handle, or a width
 * point or the line between them. Returns false when the press is on none, so the tool can do
 * what it does otherwise.
 */
export function startLiveEffectDrag(
  { event, cx, cy }: CanvasToolPointer,
  editor: Editor,
  setDrag: (d: DragState) => void
): boolean {
  const target = editor.liveEffectHandleAt(cx, cy)
  if (!target) return false
  const session = editor.beginLiveEffectDrag(target.nodeId, target.hit, { alt: event.altKey })
  // Alt on a width point removes it at once; the press is still taken.
  if (!session) return true
  setDrag({
    type: 'live-effect',
    move: session.move,
    commit: session.commit,
    cancel: session.cancel
  })
  return true
}

/**
 * Illustrator's Width tool: on a live width profile's points and line a drag sets the width there
 * (a point's middle moves it along the line, Alt removes it), and a press on any other stroked
 * layer makes it a live width profile first, then drags out a width point where it was pressed.
 */
export function widthCanvasTool(select: CanvasTool): CanvasTool {
  return {
    press: (pointer, context) => {
      const { editor, setDrag, hitFns } = context
      if (startLiveEffectDrag(pointer, editor, setDrag)) return
      const node = hitFns.hitTestLayer(pointer.cx, pointer.cy, true)
      const madeId = node ? editor.makeLiveWidth(node.id) : null
      if (!madeId) {
        select.press(pointer, context)
        return
      }
      editor.requestRender()
      startLiveEffectDrag(pointer, editor, setDrag)
    },
    hover: (pointer, context) => {
      const { editor, hitFns, cursorOverride } = context
      const node = hitFns.hitTestLayer(pointer.cx, pointer.cy, true)
      editor.setHoveredNode(node?.id ?? null)
      cursorOverride.value = editor.liveEffectHandleAt(pointer.cx, pointer.cy) ? 'pointer' : null
    }
  }
}
