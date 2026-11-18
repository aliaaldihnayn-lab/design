import type { SceneGraph } from '@lawha/scene-graph'
import { getAbsolutePosition } from '@lawha/scene-graph/coordinate'
import type { Rect, Vector } from '@lawha/scene-graph/primitives'

import { cubicPointAt } from '#core/vector/curve-math'

import { readInteractions, screensOf, type Trigger } from './model'

/** A layer's link to another screen, drawn on the canvas as Figma's prototype noodle. */
export interface PrototypeConnection {
  source: string
  target: string
  kind: 'navigate' | 'overlay' | 'scroll-to'
  trigger: Trigger['type']
  /** Which of the source layer's interactions this is, as `set_interactions` lists them. */
  interaction: number
}

/** Every interaction on the page that leads to a layer, in layer order. */
export function prototypeConnections(graph: SceneGraph, pageId: string): PrototypeConnection[] {
  const out: PrototypeConnection[] = []
  const walk = (id: string) => {
    const node = graph.getNode(id)
    if (!node || !node.visible) return
    readInteractions(node, graph).forEach(({ trigger, action }, interaction) => {
      if (action.type !== 'navigate' && action.type !== 'overlay' && action.type !== 'scroll-to')
        return
      if (!graph.getNode(action.destination)) return
      out.push({
        source: node.id,
        target: action.destination,
        kind: action.type,
        trigger: trigger.type,
        interaction
      })
    })
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

/** A point along a noodle's curve, `t` from 0 at its start to 1 at its end. */
export function noodlePoint({ start, c1, c2, end }: Noodle, t: number): Vector {
  return cubicPointAt(start, c1, c2, end, t)
}

/** How far `point` is from a noodle's curve, measured along it in short straight steps. */
export function noodleDistance(line: Noodle, point: Vector, steps = 48): number {
  let best = Number.POSITIVE_INFINITY
  let previous = line.start
  for (let i = 1; i <= steps; i++) {
    const next = noodlePoint(line, i / steps)
    best = Math.min(best, segmentDistance(previous, next, point))
    previous = next
  }
  return best
}

function segmentDistance(a: Vector, b: Vector, p: Vector): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const length = dx * dx + dy * dy
  const t =
    length === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/** The noodle nearest `point` within `tolerance`, by index; null when none is that close. */
export function noodleAt(
  lines: readonly Noodle[],
  point: Vector,
  tolerance: number
): number | null {
  let found: number | null = null
  let best = tolerance
  lines.forEach((line, index) => {
    const distance = noodleDistance(line, point)
    if (distance <= best) {
      best = distance
      found = index
    }
  })
  return found
}
