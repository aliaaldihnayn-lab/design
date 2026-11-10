import type { Editor } from '@lawha/core'

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

/** A tool that acts once, where it is clicked. */
function clickTool(act: (editor: Editor, cx: number, cy: number) => void): CanvasTool {
  return { press: ({ cx, cy }, { editor }) => act(editor, cx, cy) }
}

export const BRUSH_TOOL = strokeTool('BRUSH')
export const ERASER_TOOL = strokeTool('ERASER')
export const FILL_BUCKET_TOOL = clickTool((editor, cx, cy) => editor.pixelFillAt(cx, cy))
export const COLOR_PICKER_TOOL = clickTool((editor, cx, cy) => editor.pixelPickColorAt(cx, cy))
