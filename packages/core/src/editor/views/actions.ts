import type { EditorContext } from '#core/editor/types'

import { EDIT_VIEW, resolveEditorProfile } from './profile'
import type { CanvasView } from './types'

export function createCanvasViewActions(ctx: EditorContext) {
  function setCanvasView(view: CanvasView): void {
    ctx.state.canvasView = view
    ctx.requestRepaint()
  }

  /** Leaves the canvas's view for the one it returns to; false when there is none to leave. */
  function leaveCanvasView(): boolean {
    const target = resolveEditorProfile(ctx.state).leaveTo
    if (!target) return false
    setCanvasView(target)
    return true
  }

  /** Preview this canvas: layers holding controls run as live components. */
  function startPlay(): void {
    if (ctx.state.canvasView.id === 'play') return
    ctx.state.hoveredNodeId = null
    setCanvasView({ id: 'play', revision: 0 })
  }

  /** Go back to editing; the canvas draws every layer again. */
  function stopPlay(): void {
    if (ctx.state.canvasView.id === 'play') setCanvasView(EDIT_VIEW)
  }

  function togglePlay(): void {
    if (ctx.state.canvasView.id === 'play') stopPlay()
    else startPlay()
  }

  /** Put every control back as designed by running the islands afresh. */
  function resetPlay(): void {
    const view = ctx.state.canvasView
    if (view.id === 'play') ctx.state.canvasView = { id: 'play', revision: view.revision + 1 }
  }

  /**
   * Keys the running design answers before the view's own shortcuts, such as Escape closing an
   * open dropdown before a second press leaves the preview.
   */
  const liveKeyHandlers = new Set<(key: string) => boolean>()

  /** Lets a live island answer keys first; returns how to stop. */
  function onLiveKey(handler: (key: string) => boolean): () => void {
    liveKeyHandlers.add(handler)
    return () => liveKeyHandlers.delete(handler)
  }

  /** Offers a key to the running design; true when something there answered it. */
  function handleLiveKey(key: string): boolean {
    if (!resolveEditorProfile(ctx.state).live) return false
    for (const handler of liveKeyHandlers) if (handler(key)) return true
    return false
  }

  // Another document's layers start from their designed state, not from the old islands'.
  ctx.onEditorEvent('graph:replaced', resetPlay)

  return {
    leaveCanvasView,
    startPlay,
    stopPlay,
    togglePlay,
    resetPlay,
    onLiveKey,
    handleLiveKey
  }
}
