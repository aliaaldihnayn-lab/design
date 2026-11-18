import { useEventListener } from '@vueuse/core'
import { onScopeDispose, watch, type Ref } from 'vue'

import type { Editor, Tool } from '@lawha/core'
import { TOUCH_HANDLE_SCALE } from '@lawha/core/constants'
import type { Vector } from '@lawha/scene-graph/primitives'

import { useViewportKind } from '#vue/editor/viewport-kind'
import { setupSafariGestureZoom } from '#vue/shared/input/gesture'
import { createLongPress } from '#vue/shared/input/pan/long-press'
import type { DragState } from '#vue/shared/input/types'
import { setupWheelPanZoom } from '#vue/shared/input/wheel'

/** Tools whose press only selects or pans, so a long press can end it and open the menu instead. */
const LONG_PRESS_TOOLS: ReadonlySet<Tool> = new Set<Tool>(['SELECT', 'HAND'])

export function setupPanZoom(
  canvasRef: Ref<HTMLCanvasElement | null>,
  editor: Editor,
  drag: Ref<DragState | null>,
  onMouseDown: (e: MouseEvent) => void,
  onMouseMove: (e: MouseEvent) => void,
  onMouseUp: () => void,
  zoomSpeed: () => number = () => 1
) {
  let activeTouches: Touch[] = []
  let pinchStartDist = 0
  let pinchStartZoom = 0
  let pinchMidX = 0
  let pinchMidY = 0

  function touchDist(a: Touch, b: Touch) {
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
  }

  let touchAsMouse = false
  /** A long press opened the menu; the finger's later moves and lift do nothing. */
  let longPressFired = false

  /**
   * Opens the canvas menu where a finger held still, as a right-click does: the press it began
   * ends where it started, and a `contextmenu` event at that point selects the layer under it and
   * opens the menu the canvas's trigger owns.
   */
  function fireLongPress(start: Vector) {
    const canvas = canvasRef.value
    if (!canvas) return
    if (touchAsMouse) {
      onMouseUp()
      touchAsMouse = false
    }
    drag.value = null
    longPressFired = true
    canvas.dispatchEvent(
      new MouseEvent('contextmenu', {
        clientX: start.x,
        clientY: start.y,
        button: 2,
        bubbles: true,
        cancelable: true
      })
    )
  }

  const longPress = createLongPress(fireLongPress)
  onScopeDispose(longPress.cancel)

  function syntheticMouse(type: string, t: Touch): MouseEvent {
    return new MouseEvent(type, {
      clientX: t.clientX,
      clientY: t.clientY,
      screenX: t.screenX,
      screenY: t.screenY,
      button: 0,
      buttons: 1,
      bubbles: true
    })
  }

  function onTouchStart(e: TouchEvent) {
    e.preventDefault()
    activeTouches = Array.from(e.touches)
    const canvas = canvasRef.value
    if (!canvas) return

    if (activeTouches.length === 2) {
      longPress.cancel()
      if (touchAsMouse) {
        onMouseUp()
        touchAsMouse = false
      }
      drag.value = null
      const [a, b] = activeTouches
      pinchStartDist = touchDist(a, b)
      pinchStartZoom = editor.state.zoom
      const rect = canvas.getBoundingClientRect()
      pinchMidX = (a.clientX + b.clientX) / 2 - rect.left
      pinchMidY = (a.clientY + b.clientY) / 2 - rect.top
    } else if (activeTouches.length === 1) {
      const t = activeTouches[0]
      longPressFired = false
      if (LONG_PRESS_TOOLS.has(editor.state.activeTool)) longPress.start(t.clientX, t.clientY)
      const tool = editor.state.activeTool
      if (tool === 'HAND') {
        touchAsMouse = false
        drag.value = {
          type: 'pan',
          startScreenX: t.clientX,
          startScreenY: t.clientY,
          startPanX: editor.state.panX,
          startPanY: editor.state.panY
        }
      } else {
        touchAsMouse = true
        onMouseDown(syntheticMouse('mousedown', t))
      }
    }
  }

  function onTouchMove(e: TouchEvent) {
    e.preventDefault()
    activeTouches = Array.from(e.touches)
    const canvas = canvasRef.value
    if (!canvas) return
    if (longPressFired) return

    if (activeTouches.length === 2) {
      const [a, b] = activeTouches
      const rect = canvas.getBoundingClientRect()
      const newMidX = (a.clientX + b.clientX) / 2 - rect.left
      const newMidY = (a.clientY + b.clientY) / 2 - rect.top

      editor.setHoveredNode(null)
      const newDist = touchDist(a, b)
      if (pinchStartDist > 0) {
        const scale = newDist / pinchStartDist
        const newZoom = pinchStartZoom * scale
        const panDx = newMidX - pinchMidX
        const panDy = newMidY - pinchMidY

        editor.setZoomAroundPoint(newZoom, pinchMidX, pinchMidY)
        editor.pan(panDx, panDy)
      }

      pinchMidX = newMidX
      pinchMidY = newMidY
      editor.requestRepaint()
    } else if (activeTouches.length === 1) {
      const t = activeTouches[0]
      longPress.move(t.clientX, t.clientY)
      if (touchAsMouse) {
        onMouseMove(syntheticMouse('mousemove', t))
      } else if (drag.value?.type === 'pan') {
        const d = drag.value
        editor.state.panX = d.startPanX + (t.clientX - d.startScreenX)
        editor.state.panY = d.startPanY + (t.clientY - d.startScreenY)
        editor.requestRepaint()
      }
    }
  }

  function onTouchEnd(e: TouchEvent) {
    e.preventDefault()
    activeTouches = Array.from(e.touches)
    longPress.cancel()
    if (longPressFired) {
      if (activeTouches.length === 0) longPressFired = false
      return
    }

    if (activeTouches.length === 0) {
      if (touchAsMouse) {
        onMouseUp()
        touchAsMouse = false
      } else {
        drag.value = null
      }
      pinchStartDist = 0
    } else if (activeTouches.length === 1) {
      const t = activeTouches[0]
      if (!touchAsMouse) {
        drag.value = {
          type: 'pan',
          startScreenX: t.clientX,
          startScreenY: t.clientY,
          startPanX: editor.state.panX,
          startPanY: editor.state.panY
        }
      }
      pinchStartDist = 0
    }
  }

  // A finger needs larger handles to grab than a mouse does.
  const { isTouch } = useViewportKind()
  watch(isTouch, (touch) => editor.setHandleScale(touch ? TOUCH_HANDLE_SCALE : 1), {
    immediate: true
  })

  setupWheelPanZoom(canvasRef, editor, zoomSpeed)
  useEventListener(canvasRef, 'touchstart', onTouchStart, { passive: false })
  useEventListener(canvasRef, 'touchmove', onTouchMove, { passive: false })
  useEventListener(canvasRef, 'touchend', onTouchEnd, { passive: false })
  useEventListener(canvasRef, 'touchcancel', onTouchEnd, { passive: false })

  setupSafariGestureZoom(canvasRef, editor, zoomSpeed)
}
