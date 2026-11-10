import type { Ref } from 'vue'

import type { Editor, Tool } from '@lawha/core'

import { startPenInput, updatePenHover } from '#vue/canvas/pen/input'
import { startPencilInput } from '#vue/canvas/pencil/input'
import { hoverShapeBuilder, startShapeBuilderDrag } from '#vue/canvas/shape-builder/input'
import {
  BRUSH_TOOL,
  CLONE_STAMP_TOOL,
  COLOR_PICKER_TOOL,
  ERASER_TOOL,
  FILL_BUCKET_TOOL,
  HEALING_BRUSH_TOOL,
  MAGIC_WAND_TOOL,
  MARQUEE_ELLIPSE_TOOL,
  MARQUEE_RECT_TOOL
} from '#vue/canvas/pixels/input'
import { HAND_GRAB_CURSOR } from '#vue/editor/tool-cursor'
import { attachModifiers, startConnectorDraw } from '#vue/shared/input/connector/draw'
import { startShapeDraw, startTextDraw } from '#vue/shared/input/draw'
import { startPanDrag } from '#vue/shared/input/pan/drag'
import { handleSelectDown } from '#vue/shared/input/select'
import type { HitTestFns } from '#vue/shared/input/select'
import { startStickyDraw } from '#vue/shared/input/sticky/draw'
import type { DragState } from '#vue/shared/input/types'

/** Where the pointer is, in canvas (`cx`, `cy`) and screen (`sx`, `sy`) coordinates. */
export interface CanvasToolPointer {
  event: MouseEvent
  cx: number
  cy: number
  sx: number
  sy: number
}

/** What a canvas tool works with: the editor and the canvas input's own pieces. */
export interface CanvasToolContext {
  editor: Editor
  hitFns: HitTestFns
  cursorOverride: Ref<string | null>
  setDrag: (d: DragState) => void
  tryStartRotation: (cx: number, cy: number) => boolean
  handleTextEditClick: (cx: number, cy: number, shiftKey: boolean) => boolean
  /** Shows what the pointer is over while selecting: the cursor, guides, and auto layout. */
  hoverLayers: (pointer: CanvasToolPointer) => void
}

/** What a tool does on the canvas: on a press, and while the pointer moves with no drag. */
export interface CanvasTool {
  press: (pointer: CanvasToolPointer, context: CanvasToolContext) => void
  hover?: (pointer: CanvasToolPointer, context: CanvasToolContext) => void
}

const pan: CanvasTool = {
  press: ({ event }, { editor, setDrag, cursorOverride }) => {
    startPanDrag(event, setDrag, editor)
    cursorOverride.value = HAND_GRAB_CURSOR
  }
}

/** Draws the layer of the tool's own type, from the press to the release. */
const shape: CanvasTool = {
  press: ({ cx, cy }, { editor, setDrag }) => startShapeDraw(cx, cy, editor, setDrag)
}

/**
 * Every tool's canvas behaviour, by id. A tool added to `Tool` needs an entry here, and the
 * editor's profile decides which tools are on offer.
 */
const select: CanvasTool = {
  press: ({ event, cx, cy, sx, sy }, context) =>
    handleSelectDown(
      event,
      cx,
      cy,
      sx,
      sy,
      context.editor,
      context.hitFns,
      context.tryStartRotation,
      context.handleTextEditClick,
      context.setDrag
    ),
  hover: (pointer, { hoverLayers }) => hoverLayers(pointer)
}

export const CANVAS_TOOLS: Readonly<Record<Tool, CanvasTool>> = {
  SELECT: select,
  // Off the selected shapes' regions it selects, so shapes can be picked without switching tools.
  SHAPE_BUILDER: {
    press: (pointer, context) => {
      const { event, cx, cy } = pointer
      if (!startShapeBuilderDrag(event, cx, cy, context.editor, context.setDrag))
        select.press(pointer, context)
    },
    hover: (pointer, context) => {
      hoverShapeBuilder(pointer.event, pointer.cx, pointer.cy, context.editor)
      if (!context.editor.state.shapeBuilderHover) context.hoverLayers(pointer)
    }
  },
  HAND: pan,
  // Comments are placed by the app's comments layer above the canvas.
  COMMENT: { press: () => undefined },
  PEN: {
    press: ({ event, cx, cy }, { editor, setDrag, cursorOverride }) =>
      startPenInput(event, cx, cy, editor, setDrag, cursorOverride),
    hover: ({ cx, cy }, { editor }) => {
      updatePenHover(cx, cy, editor)
    }
  },
  PENCIL: { press: ({ cx, cy }, { editor, setDrag }) => startPencilInput(cx, cy, editor, setDrag) },
  BRUSH: BRUSH_TOOL,
  ERASER: ERASER_TOOL,
  FILL_BUCKET: FILL_BUCKET_TOOL,
  COLOR_PICKER: COLOR_PICKER_TOOL,
  MARQUEE_RECT: MARQUEE_RECT_TOOL,
  MARQUEE_ELLIPSE: MARQUEE_ELLIPSE_TOOL,
  MAGIC_WAND: MAGIC_WAND_TOOL,
  CLONE_STAMP: CLONE_STAMP_TOOL,
  HEALING_BRUSH: HEALING_BRUSH_TOOL,
  TEXT: { press: ({ cx, cy }, { editor, setDrag }) => startTextDraw(cx, cy, editor, setDrag) },
  CONNECTOR: {
    press: ({ event, cx, cy, sx, sy }, { editor, setDrag }) =>
      startConnectorDraw(cx, cy, sx, sy, editor, setDrag, attachModifiers(event)),
    hover: ({ event, cx, cy }, { editor }) => editor.connectorHover(cx, cy, attachModifiers(event))
  },
  STICKY: { press: ({ cx, cy }, { editor, setDrag }) => startStickyDraw(cx, cy, editor, setDrag) },
  FRAME: shape,
  SECTION: shape,
  RECTANGLE: shape,
  ELLIPSE: shape,
  LINE: shape,
  POLYGON: shape,
  STAR: shape,
  SHAPE_WITH_TEXT: shape
}
