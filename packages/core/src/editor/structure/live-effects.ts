import { pick } from 'es-toolkit'

import type { SceneNode } from '@lawha/scene-graph'
import { MAX_WIDTH_POINTS, type PathEffect } from '@lawha/scene-graph/path-effects'
import type { Vector } from '@lawha/scene-graph/primitives'

import {
  canvasToParent,
  liveEffectHandleAt,
  meshPointIn,
  nearestOnCentre,
  liveEffectHandlesForState,
  type LiveEffectHandleHit,
  type LiveEffectHandles
} from '#core/canvas/live-effect-handles'
import {
  applyLiveEffect,
  effectSourceBox,
  pathEffectOf,
  updateLiveEffect,
  type PathEffectSettings
} from '#core/canvas/live-effects'
import { widthStroke } from '#core/canvas/path-effects'
import type { SkiaRenderer } from '#core/canvas/renderer'
import type { EditorContext } from '#core/editor/types'
import { widthAt } from '#core/vector/width'

import { placeOf, recordLayerSwap } from './swap'

/** How near, in screen pixels, a press must be to take hold of a live effect's handle. */
const HANDLE_REACH = 6

/** The fields a live effect's edit changes on the vector it made. */
const LIVE_EFFECT_FIELDS = ['x', 'y', 'width', 'height', 'vectorNetwork', 'pluginData'] as const

/** An edit of a live effect held by a drag: it reshapes as the pointer moves. */
export interface LiveEffectDrag {
  move: (cx: number, cy: number) => void
  commit: () => void
  cancel: () => void
}

/** The settings a drag to `point` (in the parent) gives an effect, by what it took hold of. */
function draggedSettings(
  r: SkiaRenderer,
  node: SceneNode,
  effect: PathEffect,
  hit: LiveEffectHandleHit,
  point: Vector,
  start: { widthIndex: number | null }
): PathEffectSettings | null {
  if (effect.kind === 'mesh' && (hit.kind === 'mesh-point' || hit.kind === 'mesh-handle')) {
    const box = effectSourceBox(r, node, effect)
    if (!box) return null
    const index = hit.row * (effect.columns + 1) + hit.column
    const points = effect.points.map((p) => ({ ...p }))
    const at = meshPointIn(box, point)
    points[index] =
      hit.kind === 'mesh-point'
        ? { ...points[index], ...at }
        : {
            ...points[index],
            [hit.side]: { x: at.x - points[index].x, y: at.y - points[index].y }
          }
    const { source: _source, ...rest } = effect
    return { ...rest, points }
  }
  if (effect.kind !== 'width' || start.widthIndex === null) return null
  const nearest = nearestOnCentre(r, node, point)
  if (!nearest) return null
  const points = effect.points.map((p) => ({ ...p }))
  const index = start.widthIndex
  const along = hit.kind === 'width-point' && hit.along
  if (along) points[index] = { ...points[index], t: nearest.t }
  else
    points[index] = {
      ...points[index],
      width: Math.min(20, (2 * nearest.distance) / Math.max(effect.weight, 1e-9))
    }
  return { kind: 'width', weight: effect.weight, points }
}

/** The live effect actions the canvas uses: its handles, what a press takes, and drags. */
export function createLiveEffectActions(ctx: EditorContext) {
  function handles(): LiveEffectHandles | null {
    const renderer = ctx.getRenderer()
    return renderer ? liveEffectHandlesForState(renderer, ctx.graph, ctx.state) : null
  }

  /**
   * Picks a mesh point, whose curve handles then show: alone, or with Shift added to the points
   * already picked, or taken out of them when it was one, as Illustrator's Direct Selection does.
   */
  function pickMeshPoint(nodeId: string, index: number, extend: boolean) {
    const current = ctx.state.meshPointSelection
    const kept = extend && current?.nodeId === nodeId ? current.indices : []
    let indices = [...kept, index]
    if (kept.includes(index)) indices = extend ? kept.filter((i) => i !== index) : kept
    ctx.state.meshPointSelection = { nodeId, indices }
    ctx.requestRepaint()
  }

  /** The live effect handle under a canvas point, and the layer it belongs to. */
  function liveEffectHandleAtPoint(cx: number, cy: number) {
    const renderer = ctx.getRenderer()
    const shown = handles()
    if (!renderer || !shown) return null
    const radius = HANDLE_REACH / Math.max(ctx.state.zoom, 1e-6)
    const hit = liveEffectHandleAt(renderer, ctx.graph, shown, { x: cx, y: cy }, radius)
    return hit ? { nodeId: shown.nodeId, hit } : null
  }

  /**
   * Makes a stroked layer a live width profile of even width, as the Width tool does the first
   * time it touches a stroke: a layer with a fill keeps it, without its stroke, under the
   * profile. Returns the profile's id, or null when the layer has no visible stroke.
   */
  function makeLiveWidth(nodeId: string): string | null {
    const renderer = ctx.getRenderer()
    const node = ctx.graph.getNode(nodeId)
    if (!renderer || !node?.parentId) return null
    if (pathEffectOf(node)?.kind === 'width') return node.id
    const painted = widthStroke(node)
    if (!painted) return null
    const points = [
      { t: 0, width: 1 },
      { t: 1, width: 1 }
    ]
    const props = applyLiveEffect(renderer, ctx.graph, node, {
      kind: 'width',
      weight: painted.weight,
      points
    })
    const place = placeOf(ctx, node.id)
    const parent = ctx.graph.getNode(node.parentId)
    if (!props || !place || !parent) return null
    const prevSelection = new Set(ctx.state.selectedIds)
    const vector = ctx.graph.createNode('VECTOR', parent.id, props)
    ctx.graph.insertChildAt(vector.id, parent.id, place.index + 1)
    const keepsFill = node.fills.some((fill) => fill.visible)
    if (keepsFill) ctx.graph.updateNode(node.id, { strokes: [] })
    else ctx.graph.deleteNode(node.id)
    const made = keepsFill ? [node.id, vector.id] : [vector.id]
    recordLayerSwap(ctx, 'Width profile', [place], made, prevSelection)
    ctx.setSelectedIds(new Set([vector.id]))
    return vector.id
  }

  /**
   * Starts dragging a live effect's handle: a mesh point or handle, a width point's width or its
   * place along the line, or the line itself, which adds a width point there. Alt on a width
   * point removes it instead, at once. The edit is one undo step when the drag is committed.
   */
  function beginLiveEffectDrag(
    nodeId: string,
    hit: LiveEffectHandleHit,
    options: { alt?: boolean; shift?: boolean } = {}
  ): LiveEffectDrag | null {
    const renderer = ctx.getRenderer()
    const node = ctx.graph.getNode(nodeId)
    const effect = node && pathEffectOf(node)
    if (!renderer || !node || !effect) return null
    if (effect.kind === 'mesh' && hit.kind === 'mesh-point')
      pickMeshPoint(nodeId, hit.row * (effect.columns + 1) + hit.column, options.shift === true)
    const before = pick(node, LIVE_EFFECT_FIELDS)
    const apply = (settings: PathEffectSettings | null) => {
      const current = ctx.graph.getNode(nodeId)
      const props = settings && current ? updateLiveEffect(renderer, current, settings) : null
      if (props) ctx.graph.updateNode(nodeId, props)
      ctx.requestRender()
      return props !== null
    }
    const finish = (label: string) => {
      const current = ctx.graph.getNode(nodeId)
      if (!current) return
      const after = pick(current, LIVE_EFFECT_FIELDS)
      if (after.pluginData === before.pluginData) return
      const restore = (values: typeof before) => {
        ctx.graph.updateNode(nodeId, { ...values })
        ctx.requestRender()
      }
      ctx.undo.push({ label, forward: () => restore(after), inverse: () => restore(before) })
    }

    const start = { widthIndex: hit.kind === 'width-point' ? hit.index : null }
    if (effect.kind === 'width' && hit.kind === 'width-path') {
      if (effect.points.length >= MAX_WIDTH_POINTS) return null
      const points = [...effect.points, { t: hit.t, width: widthAt(effect.points, hit.t) }]
      if (!apply({ kind: 'width', weight: effect.weight, points })) return null
      start.widthIndex = points.length - 1
    }
    if (effect.kind === 'width' && hit.kind === 'width-point' && options.alt) {
      if (effect.points.length > 1) {
        const points = effect.points.filter((_, i) => i !== hit.index)
        apply({ kind: 'width', weight: effect.weight, points })
        finish('Remove width point')
      }
      return null
    }

    const label = effect.kind === 'mesh' ? 'Edit mesh' : 'Edit width'
    let done = false
    return {
      move: (cx, cy) => {
        if (done) return
        const current = ctx.graph.getNode(nodeId)
        // The effect as it is now: its outline is kept where the vector is now.
        const now = current && pathEffectOf(current)
        const point = current && canvasToParent(ctx.graph, current, { x: cx, y: cy })
        if (!current || !now || !point) return
        apply(draggedSettings(renderer, current, now, hit, point, start))
      },
      commit: () => {
        if (done) return
        done = true
        finish(label)
      },
      cancel: () => {
        if (done) return
        done = true
        ctx.graph.updateNode(nodeId, { ...before })
        ctx.requestRender()
      }
    }
  }

  return {
    liveEffectHandles: handles,
    liveEffectHandleAt: liveEffectHandleAtPoint,
    makeLiveWidth,
    pickMeshPoint,
    beginLiveEffectDrag
  }
}
