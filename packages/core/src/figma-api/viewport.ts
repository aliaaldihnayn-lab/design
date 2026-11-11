import { computeBounds } from '@lawha/scene-graph/geometry'
import type { Rect, Vector } from '@lawha/scene-graph/primitives'

import { IS_BROWSER } from '#core/constants'

/** What `figma.viewport` reads as: the view's centre and zoom, and a way to frame layers. */
export interface FigmaViewport {
  center: Vector
  zoom: number
  scrollAndZoomIntoView: (nodes: readonly { absoluteBoundingBox: Rect }[]) => void
}

/** Padding round layers a script scrolls and zooms into view, in canvas pixels. */
const FRAME_PADDING = 80

/**
 * The view a script sees and moves. A script has no canvas of its own, so the view is kept here
 * and framing layers sizes it to the window, or to 1280 × 720 where there is none.
 */
export class ScriptViewport {
  private state = { x: 0, y: 0, zoom: 1 }

  read(): FigmaViewport {
    return {
      center: { x: this.state.x, y: this.state.y },
      zoom: this.state.zoom,
      scrollAndZoomIntoView: (nodes) => {
        const b = computeBounds(nodes.map((n) => n.absoluteBoundingBox))
        if (b.width === 0 && b.height === 0 && nodes.length === 0) return
        const contentW = b.width + FRAME_PADDING * 2
        const contentH = b.height + FRAME_PADDING * 2
        const viewW = IS_BROWSER ? window.innerWidth : 1280
        const viewH = IS_BROWSER ? window.innerHeight : 720
        const zoom = Math.min(viewW / contentW, viewH / contentH, 1)
        this.state = { x: b.x + b.width / 2, y: b.y + b.height / 2, zoom }
      }
    }
  }

  write(view: { center: Vector; zoom: number }): void {
    this.state = { x: view.center.x, y: view.center.y, zoom: view.zoom }
  }
}
