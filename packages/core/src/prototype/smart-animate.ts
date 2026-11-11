import type { SceneGraph, SceneNode } from '@lawha/scene-graph'
import { getAbsolutePosition } from '@lawha/scene-graph/coordinate'
import type { Rect, Vector } from '@lawha/scene-graph/primitives'

import { extractPageContext, findPageId } from '#core/io/subgraph'

import type { Transition } from './model'

/** A layer's place on its screen and how it draws, the values Smart Animate tweens. */
export interface LayerState extends Rect {
  opacity: number
  rotation: number
}

/** A layer on the outgoing screen and the layer it becomes on the incoming one. */
export interface SmartPair {
  /** Names from the screen down, as Figma matches them. */
  path: string
  from: string
  to: string
  fromState: LayerState
  toState: LayerState
}

export interface SmartAnimatePlan {
  /** Matched layers, in the incoming screen's paint order (back to front). */
  pairs: SmartPair[]
  /** Layers only the outgoing screen has: they fade out. */
  removed: string[]
  /** Layers only the incoming screen has: they fade in. */
  added: string[]
}

/**
 * Each visible layer under a screen by its path of names, as Figma's Smart Animate matches
 * layers: same name, same parent names. Siblings sharing a name match in order.
 */
function layerPaths(graph: SceneGraph, screenId: string): Map<string, SceneNode> {
  const out = new Map<string, SceneNode>()
  const walk = (parent: SceneNode, prefix: string) => {
    const seen = new Map<string, number>()
    for (const id of parent.childIds) {
      const node = graph.getNode(id)
      if (!node || !node.visible) continue
      const count = seen.get(node.name) ?? 0
      seen.set(node.name, count + 1)
      const path = `${prefix}${node.name}${count > 0 ? `#${count}` : ''}`
      out.set(path, node)
      walk(node, `${path}/`)
    }
  }
  const screen = graph.getNode(screenId)
  if (screen) walk(screen, '')
  return out
}

function stateOf(graph: SceneGraph, node: SceneNode, origin: Vector): LayerState {
  const at = getAbsolutePosition(node, graph)
  return {
    x: at.x - origin.x,
    y: at.y - origin.y,
    width: node.width,
    height: node.height,
    opacity: node.opacity,
    rotation: node.rotation
  }
}

/** Matches the layers of two screens for Smart Animate. */
export function smartAnimatePlan(
  graph: SceneGraph,
  fromScreenId: string,
  toScreenId: string
): SmartAnimatePlan {
  const fromScreen = graph.getNode(fromScreenId)
  const toScreen = graph.getNode(toScreenId)
  if (!fromScreen || !toScreen) return { pairs: [], removed: [], added: [] }
  const fromOrigin = getAbsolutePosition(fromScreen, graph)
  const toOrigin = getAbsolutePosition(toScreen, graph)
  const from = layerPaths(graph, fromScreenId)
  const to = layerPaths(graph, toScreenId)
  const pairs: SmartPair[] = []
  const added: string[] = []
  for (const [path, node] of to) {
    const match = from.get(path)
    if (!match) {
      added.push(node.id)
      continue
    }
    pairs.push({
      path,
      from: match.id,
      to: node.id,
      fromState: stateOf(graph, match, fromOrigin),
      toState: stateOf(graph, node, toOrigin)
    })
  }
  const matched = new Set(pairs.map((pair) => pair.from))
  const removed = [...from.values()].filter((node) => !matched.has(node.id)).map((n) => n.id)
  return { pairs, removed, added }
}

/** Whether a pair changes at all between the screens; unchanged pairs need no animation. */
export function pairChanges(pair: SmartPair): boolean {
  const a = pair.fromState
  const b = pair.toState
  return (
    a.x !== b.x ||
    a.y !== b.y ||
    a.width !== b.width ||
    a.height !== b.height ||
    a.opacity !== b.opacity ||
    a.rotation !== b.rotation
  )
}

/**
 * The affine map, as `[scaleX, scaleY, translateX, translateY]`, that carries rectangle `from`
 * onto rectangle `to` with the origin at the top left: what a full-screen image of a layer is
 * transformed by so the layer lands where it sits on the other screen.
 */
export function rectMapping(from: Rect, to: Rect): [number, number, number, number] {
  const sx = from.width === 0 ? 1 : to.width / from.width
  const sy = from.height === 0 ? 1 : to.height / from.height
  return [sx, sy, to.x - from.x * sx, to.y - from.y * sy]
}

function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const sample = (a: number, b: number, s: number) =>
    3 * a * s * (1 - s) ** 2 + 3 * b * s ** 2 * (1 - s) + s ** 3
  return (t) => {
    if (t <= 0) return 0
    if (t >= 1) return 1
    // Solve x(s) = t by bisection: monotonic for the curves Figma offers.
    let lo = 0
    let hi = 1
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2
      if (sample(x1, x2, mid) < t) lo = mid
      else hi = mid
    }
    return sample(y1, y2, (lo + hi) / 2)
  }
}

/** Figma's gentle spring: a damped oscillation that settles at 1. */
function spring(t: number): number {
  if (t <= 0) return 0
  if (t >= 1) return 1
  return 1 - Math.exp(-6 * t) * Math.cos(2.5 * Math.PI * t)
}

/** A spring's physics: how stiff, how damped, and how heavy, as Figma's custom spring. */
export interface SpringPhysics {
  stiffness: number
  damping: number
  mass: number
}

const DEFAULT_SPRING: SpringPhysics = { stiffness: 300, damping: 20, mass: 1 }

/**
 * Where a damped spring from 0 to 1 is after `seconds`, solving the spring's equation of
 * motion in closed form for the under-, critically, and over-damped cases.
 */
function springAt(physics: SpringPhysics, seconds: number): number {
  const { stiffness, damping, mass } = physics
  const omega = Math.sqrt(stiffness / mass)
  const zeta = damping / (2 * Math.sqrt(stiffness * mass))
  if (zeta < 1) {
    const damped = omega * Math.sqrt(1 - zeta * zeta)
    const envelope = Math.exp(-zeta * omega * seconds)
    return (
      1 -
      envelope *
        (Math.cos(damped * seconds) + ((zeta * omega) / damped) * Math.sin(damped * seconds))
    )
  }
  if (zeta === 1) return 1 - Math.exp(-omega * seconds) * (1 + omega * seconds)
  const root = omega * Math.sqrt(zeta * zeta - 1)
  const a = -zeta * omega + root
  const b = -zeta * omega - root
  return 1 - (b * Math.exp(a * seconds) - a * Math.exp(b * seconds)) / (b - a)
}

/**
 * How long a spring takes to settle within a thousandth of its rest, in ms, capped at 5 s: a
 * custom spring's duration comes from its physics, not from the transition's duration.
 */
export function springDuration(physics: SpringPhysics = DEFAULT_SPRING): number {
  const step = 1 / 120
  let settledSince = 0
  for (let seconds = 0; seconds < 5; seconds += step) {
    const settled = Math.abs(1 - springAt(physics, seconds)) < 1e-3
    if (!settled) settledSince = seconds + step
    else if (seconds - settledSince > 0.1) return Math.round(settledSince * 1000)
  }
  return 5000
}

/** A custom spring as progress over normalised time, settling at 1 by `t = 1`. */
export function springEasing(physics: SpringPhysics = DEFAULT_SPRING): (t: number) => number {
  const seconds = springDuration(physics) / 1000
  return (t) => {
    if (t <= 0) return 0
    if (t >= 1) return 1
    return springAt(physics, t * seconds)
  }
}

const EASING_FUNCTIONS: Record<Transition['easing'], (t: number) => number> = {
  linear: (t) => Math.min(1, Math.max(0, t)),
  'ease-in': cubicBezier(0.42, 0, 1, 1),
  'ease-out': cubicBezier(0, 0, 0.58, 1),
  'ease-in-out': cubicBezier(0.42, 0, 0.58, 1),
  'ease-in-back': cubicBezier(0.3, -0.05, 0.7, -0.5),
  'ease-out-back': cubicBezier(0.45, 1.45, 0.8, 1),
  'ease-in-out-back': cubicBezier(0.7, -0.4, 0.4, 1.4),
  spring,
  'custom-spring': springEasing()
}

/** Progress along an easing curve at time `t` from 0 to 1. */
export function ease(easing: Transition['easing'], t: number, physics?: SpringPhysics): number {
  if (easing === 'custom-spring' && physics) return springEasing(physics)(t)
  return EASING_FUNCTIONS[easing](t)
}

/**
 * How long a transition runs, in ms: its duration, or for a custom spring the time its physics
 * take to settle.
 */
export function transitionDuration(transition: Transition): number {
  if (transition.type === 'instant') return 0
  if (transition.easing === 'custom-spring') return springDuration(transition.spring)
  return transition.duration
}

/**
 * The transition's progress sampled at `steps + 1` evenly spaced times, as keyframe offsets
 * and eased progress, for animation APIs that take keyframes rather than a curve: the
 * springs and "back" easings overshoot, which CSS's cubic-bezier cannot always draw.
 */
export function easedKeyframes(
  transition: Transition,
  steps = 30
): { offset: number; progress: number }[] {
  const frames: { offset: number; progress: number }[] = []
  for (let i = 0; i <= steps; i++) {
    const offset = i / steps
    frames.push({ offset, progress: ease(transition.easing, offset, transition.spring) })
  }
  return frames
}

const mix = (a: number, b: number, k: number) => a + (b - a) * k

/** A layer's state part way through the tween, at time `t` from 0 to 1. */
export function tweenState(
  from: LayerState,
  to: LayerState,
  t: number,
  easing: Transition['easing'] = 'ease-out'
): LayerState {
  const k = ease(easing, t)
  return {
    x: mix(from.x, to.x, k),
    y: mix(from.y, to.y, k),
    width: mix(from.width, to.width, k),
    height: mix(from.height, to.height, k),
    opacity: mix(from.opacity, to.opacity, k),
    rotation: mix(from.rotation, to.rotation, k)
  }
}

/** What a frame image of one screen shows: the whole screen less some layers, or one layer. */
export type SmartAnimateLayer =
  | { kind: 'background'; hide: readonly string[] }
  | { kind: 'layer'; node: string; hide: readonly string[] }

/**
 * A private copy of a screen's page for drawing one Smart Animate frame image: the screen
 * without `hide` (the layers that move on their own), or a single layer by itself on a clear
 * screen, everything else hidden and its containers' own paint removed, so the image places
 * the layer exactly where it sits on the screen. Every copy clips to the screen and drops its
 * shadows, so each image covers exactly the screen's box.
 */
export function smartAnimateGraph(
  graph: SceneGraph,
  screenId: string,
  layer: SmartAnimateLayer
): { graph: SceneGraph; pageId: string } | null {
  const pageId = findPageId(graph, screenId)
  if (!pageId) return null
  const copy = extractPageContext(graph, pageId, [screenId])
  // Every image is exactly the screen's box, so the player can lay them over each other.
  copy.updateNode(screenId, { clipsContent: true, effects: [] })
  const hide = (id: string) => {
    if (copy.getNode(id)) copy.updateNode(id, { visible: false })
  }
  if (layer.kind === 'background') {
    layer.hide.forEach(hide)
    return { graph: copy, pageId }
  }
  // The chain from the layer up to the screen keeps only that branch and draws no paint.
  let childOnPath = layer.node
  let ancestorId = copy.getNode(layer.node)?.parentId ?? null
  while (ancestorId) {
    const ancestor = copy.getNode(ancestorId)
    if (!ancestor) break
    for (const id of ancestor.childIds) if (id !== childOnPath) hide(id)
    copy.updateNode(ancestorId, { fills: [], strokes: [], effects: [] })
    if (ancestorId === screenId) break
    childOnPath = ancestorId
    ancestorId = ancestor.parentId
  }
  // Only layers inside this one: hiding an ancestor would hide the layer itself.
  const inside = (id: string) => {
    let node = copy.getNode(id)
    while (node?.parentId) {
      if (node.parentId === layer.node) return true
      node = copy.getNode(node.parentId)
    }
    return false
  }
  layer.hide.filter(inside).forEach(hide)
  return { graph: copy, pageId }
}
