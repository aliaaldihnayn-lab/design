import { selectionModeFor, type Editor } from '@lawha/core'

import type { CanvasTool } from '#vue/canvas/tools/registry'

/** The brush or eraser: a press starts a stroke on the layer under it, the drag paints. */
function strokeTool(tool: 'BRUSH' | 'ERASER'): CanvasTool {
  return {
    press: ({ cx, cy }, { editor, setDrag }) => {
      if (!editor.pixelStrokeBegin(tool, cx, cy)) return
      setDrag({
        type: 'pixel',
        move: (x, y) => editor.pixelStrokeMove(x, y),
        commit: () => editor.pixelStrokeEnd(),
        cancel: () => editor.pixelStrokeCancel()
      })
    },
    hover: ({ cx, cy }, { editor }) => editor.pixelHover(cx, cy)
  }
}

/** Shift adds to the selection, Alt subtracts, both intersect. */
function selectionMode(editor: Editor, event: MouseEvent) {
  return selectionModeFor(
    { shift: event.shiftKey, alt: event.altKey },
    editor.state.pixelTools.selectionMode
  )
}

/** A rectangle or ellipse selection, dragged out on the layer; Shift while dragging squares it. */
function marqueeTool(kind: 'rect' | 'ellipse'): CanvasTool {
  return {
    press: ({ event, cx, cy }, { editor, setDrag }) => {
      if (!editor.pixelSelectBegin(kind, cx, cy, selectionMode(editor, event))) return
      setDrag({
        type: 'pixel',
        move: (x, y, shiftKey) => editor.pixelSelectMove(x, y, shiftKey),
        commit: () => editor.pixelSelectEnd(),
        cancel: () => editor.pixelSelectCancel()
      })
    }
  }
}

export const MARQUEE_RECT_TOOL = marqueeTool('rect')
export const MARQUEE_ELLIPSE_TOOL = marqueeTool('ellipse')
export const MAGIC_WAND_TOOL: CanvasTool = {
  press: ({ event, cx, cy }, { editor }) =>
    editor.pixelMagicWandAt(cx, cy, selectionMode(editor, event))
}

/** A tool that acts once, where it is clicked. */
function clickTool(act: (editor: Editor, cx: number, cy: number) => void): CanvasTool {
  return { press: ({ cx, cy }, { editor }) => act(editor, cx, cy) }
}

export const BRUSH_TOOL = strokeTool('BRUSH')
export const ERASER_TOOL = strokeTool('ERASER')
export const FILL_BUCKET_TOOL = clickTool((editor, cx, cy) => editor.pixelFillAt(cx, cy))
export const COLOR_PICKER_TOOL = clickTool((editor, cx, cy) => editor.pixelPickColorAt(cx, cy))
