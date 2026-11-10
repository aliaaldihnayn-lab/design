import type { SceneGraph } from '@lawha/scene-graph'
import { getAbsolutePosition } from '@lawha/scene-graph/coordinate'
import type { Rect, Vector } from '@lawha/scene-graph/primitives'

import { readInteractions, screensOf, type Trigger } from './model'

/** A layer's link to another screen, drawn on the canvas as Figma's prototype noodle. */
export interface PrototypeConnection {
  source: string
  target: string
  kind: 'navigate' | 'overlay' | 'scroll-to'
  trigger: Trigger['type']
}

/** Every interaction on the page that leads to a layer, in layer order. */
export function prototypeConnections(graph: SceneGraph, pageId: string): PrototypeConnection[] {
  const out: PrototypeConnection[] = []
  const walk = (id: string) => {
    const node = graph.getNode(id)
    if (!node || !node.visible) return
    for (const { trigger, action } of readInteractions(node, graph)) {
      if (action.type !== 'navigate' && action.type !== 'overlay' && action.type !== 'scroll-to')
        continue
      if (!graph.getNode(action.destination)) continue
      out.push({
        source: node.id,
        target: action.destination,
        kind: action.type,
        trigger: trigger.type
      })
    }
    node.childIds.forEach(walk)
  }
  graph.getNode(pageId)?.childIds.forEach(walk)
  return out
}

/** A layer's box in canvas coordinates, ignoring rotation. */
export function canvasRect(graph: SceneGraph, nodeId: string): Rect | null {
  const node = graph.getNode(nodeId)
  if (!node) return null
  const at = getAbsolutePosition(node, graph)
  return { x: at.x, y: at.y, width: node.width, height: node.height }
}

/** The screen under a canvas point, topmost first; null over empty canvas. */
export function screenAt(graph: SceneGraph, pageId: string, point: Vector): string | null {
  const screens = screensOf(graph, pageId)
  for (let i = screens.length - 1; i >= 0; i--) {
    const rect = canvasRect(graph, screens[i].id)
    if (
      rect &&
      point.x >= rect.x &&
      point.x <= rect.x + rect.width &&
      point.y >= rect.y &&
      point.y <= rect.y + rect.height
    )
      return screens[i].id
  }
  return null
}

/** A noodle: a cubic curve from the source layer to the target screen, ending in an arrow. */
export interface Noodle {
  start: Vector
  c1: Vector
  c2: Vector
  end: Vector
  /** The arrowhead's two back corners and its tip, which is `end`. */
  arrow: [Vector, Vector, Vector]
}

/**
 * Where a noodle runs, as Figma draws it: out of the side of the source that faces the target,
 * into the target's facing side at the source's height when it can, else near its top. Works in
 * any coordinate space the two boxes share; `arrow` is the arrowhead's length in that space.
 */
export function noodle(source: Rect, target: Rect | Vector, arrow = 8): Noodle {
  const toRect: Rect = 'width' in target ? target : { ...target, width: 0, height: 0 }
  const sourceCenter = source.x + source.width / 2
  const targetCenter = toRect.x + toRect.width / 2
  const rightward = targetCenter >= sourceCenter
  const start = {
    x: rightward ? source.x + source.width : source.x,
    y: source.y + source.height / 2
  }
  const inset = Math.min(12, toRect.height / 2)
  const end = {
    x: rightward ? toRect.x : toRect.x + toRect.width,
    y: Math.min(Math.max(start.y, toRect.y + inset), toRect.y + toRect.height - inset)
  }
  const reach = Math.max(40, Math.abs(end.x - start.x) / 2)
  const sign = rightward ? 1 : -1
  const c1 = { x: start.x + sign * reach, y: start.y }
  const c2 = { x: end.x - sign * reach, y: end.y }
  // The arrow points along the curve's last tangent, which runs from c2 into the end.
  const dx = end.x - c2.x
  const dy = end.y - c2.y
  const length = Math.hypot(dx, dy) || 1
  const ux = dx / length
  const uy = dy / length
  const back = { x: end.x - ux * arrow, y: end.y - uy * arrow }
  const half = arrow * 0.6
  return {
    start,
    c1,
    c2,
    end,
    arrow: [
      { x: back.x - uy * half, y: back.y + ux * half },
      { x: back.x + uy * half, y: back.y - ux * half },
      end
    ]
  }
}

/** The SVG path data of a noodle's curve. */
export function noodlePath({ start, c1, c2, end }: Noodle): string {
  return `M ${start.x} ${start.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${end.x} ${end.y}`
}
