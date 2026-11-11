import * as v from 'valibot'

import type { SceneNode } from '@lawha/scene-graph'
import {
  MAX_MESH_CELLS,
  MAX_WIDTH_POINTS,
  WARP_PRESETS,
  type MeshPoint,
  type PathEffect
} from '@lawha/scene-graph/path-effects'

import {
  effectSourceBox,
  expandLiveEffect,
  pathEffectOf,
  releaseLiveEffect,
  updateLiveEffect,
  type PathEffectSettings
} from '#core/canvas/live-effects'
import type { SkiaRenderer } from '#core/canvas/renderer'
import { replaceWithVector } from '#core/editor/structure/swap'
import type { FigmaAPI } from '#core/figma-api'
import { measuringRenderer } from '#core/figma-api/measure'
import { defineTool } from '#core/tools/schema'
import { resampleMesh } from '#core/vector/warp'

const NO_RENDERER = 'Live effects need path geometry, which this host cannot measure'

function liveLayer(figma: FigmaAPI, id: string) {
  const node = figma.graph.getNode(id)
  if (!node) return { error: `Node ${id} not found` }
  const effect = pathEffectOf(node)
  if (!effect) return { error: `${node.name} has no live warp, mesh, or width profile` }
  return { node, effect }
}

/** What a tool reports of a live effect: its settings, without the outline it keeps. */
function describe(node: SceneNode, effect: PathEffect) {
  const { source: _source, ...settings } = effect
  return { id: node.id, name: node.name, ...settings }
}

export const getPathEffect = defineTool({
  name: 'get_path_effect',
  description:
    'Read the live warp, envelope mesh, or width profile of layers made by warp_shape, envelope_mesh, or width_profile: the warp preset and amounts, the mesh size and every point (in units of the outline box, 0…1, with handle offsets), or the width points.',
  execution: { kind: 'sync', mutation: 'none' },
  input: v.strictObject({ ids: v.pipe(v.array(v.string()), v.minLength(1)) }),
  execute: (figma, { ids }) => {
    const effects: ReturnType<typeof describe>[] = []
    for (const id of ids) {
      const found = liveLayer(figma, id)
      if ('error' in found) return found
      effects.push(describe(found.node, found.effect))
    }
    return { effects }
  }
})

const meshMoveSchema = v.strictObject({
  row: v.pipe(v.number(), v.integer(), v.minValue(0)),
  column: v.pipe(v.number(), v.integer(), v.minValue(0)),
  dx: v.number(),
  dy: v.number()
})

const meshHandleSchema = v.strictObject({
  row: v.pipe(v.number(), v.integer(), v.minValue(0)),
  column: v.pipe(v.number(), v.integer(), v.minValue(0)),
  side: v.picklist(['left', 'right', 'up', 'down']),
  dx: v.pipe(v.number(), v.description('Handle end from its point, pixels')),
  dy: v.number()
})

const editInputSchema = v.strictObject({
  id: v.string(),
  preset: v.optional(v.picklist(WARP_PRESETS)),
  bend: v.optional(v.pipe(v.number(), v.minValue(-1), v.maxValue(1))),
  horizontal: v.optional(v.pipe(v.number(), v.minValue(-1), v.maxValue(1))),
  vertical: v.optional(v.pipe(v.number(), v.minValue(-1), v.maxValue(1))),
  direction: v.optional(v.picklist(['horizontal', 'vertical'])),
  rows: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(MAX_MESH_CELLS))),
  columns: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(MAX_MESH_CELLS))),
  moves: v.optional(v.array(meshMoveSchema)),
  handles: v.optional(v.array(meshHandleSchema)),
  points: v.optional(
    v.pipe(
      v.array(
        v.strictObject({
          t: v.pipe(v.number(), v.minValue(0), v.maxValue(1)),
          width: v.pipe(v.number(), v.minValue(0), v.maxValue(20))
        })
      ),
      v.minLength(1),
      v.maxLength(MAX_WIDTH_POINTS)
    )
  )
})

type EditInput = v.InferOutput<typeof editInputSchema>

/** A mesh's settings after the edit: resized first, then points and handles moved. */
function editedMesh(
  r: SkiaRenderer,
  node: SceneNode,
  effect: Extract<PathEffect, { kind: 'mesh' }>,
  args: EditInput
): PathEffectSettings | { error: string } {
  const box = effectSourceBox(r, node, effect)
  if (!box) return { error: `${node.name} has no outline to mesh` }
  const rows = args.rows ?? effect.rows
  const columns = args.columns ?? effect.columns
  const points: MeshPoint[] =
    rows === effect.rows && columns === effect.columns
      ? effect.points.map((point) => ({ ...point }))
      : resampleMesh(effect.rows, effect.columns, effect.points, rows, columns)
  const w = Math.max(box.width, 1e-9)
  const h = Math.max(box.height, 1e-9)
  const indexOf = (edit: { row: number; column: number }) =>
    edit.row > rows || edit.column > columns ? null : edit.row * (columns + 1) + edit.column
  const outside = (edit: { row: number; column: number }) => ({
    error: `Grid point ${edit.row},${edit.column} is outside a ${rows}×${columns} mesh`
  })
  for (const move of args.moves ?? []) {
    const index = indexOf(move)
    if (index === null) return outside(move)
    const point = points[index]
    points[index] = { ...point, x: point.x + move.dx / w, y: point.y + move.dy / h }
  }
  for (const handle of args.handles ?? []) {
    const index = indexOf(handle)
    if (index === null) return outside(handle)
    points[index] = { ...points[index], [handle.side]: { x: handle.dx / w, y: handle.dy / h } }
  }
  return { kind: 'mesh', rows, columns, points }
}

/** The settings an edit gives a live effect, keeping what it leaves out. */
export function editedEffectSettings(
  r: SkiaRenderer,
  node: SceneNode,
  effect: PathEffect,
  args: EditInput
): PathEffectSettings | { error: string } {
  switch (effect.kind) {
    case 'warp':
      return {
        kind: 'warp',
        preset: args.preset ?? effect.preset,
        bend: args.bend ?? effect.bend,
        horizontal: args.horizontal ?? effect.horizontal,
        vertical: args.vertical ?? effect.vertical,
        vertically: args.direction ? args.direction === 'vertical' : effect.vertically
      }
    case 'mesh':
      return editedMesh(r, node, effect, args)
    case 'width':
      return { kind: 'width', weight: effect.weight, points: args.points ?? effect.points }
    default: {
      const exhaustive: never = effect
      return exhaustive
    }
  }
}

export const editPathEffect = defineTool({
  name: 'edit_path_effect',
  description:
    "Edit a live warp, envelope mesh, or width profile, which reshapes the layer again from the outline it keeps, as editing Illustrator's envelope or width points: for a warp give preset, bend, horizontal, vertical, direction; for a mesh give rows and columns (the mesh is resampled), moves (grid points by dx, dy pixels), and handles (a point's left, right, up or down curve handle, its end dx, dy pixels from the point); for a width profile give points (t 0…1 along the path, width as a multiple of the stroke weight). Settings left out stay.",
  execution: { kind: 'sync', mutation: 'document' },
  input: editInputSchema,
  execute: (figma, args) => {
    const renderer = measuringRenderer(figma)
    if (!renderer) return { error: NO_RENDERER }
    const found = liveLayer(figma, args.id)
    if ('error' in found) return found
    const settings = editedEffectSettings(renderer, found.node, found.effect, args)
    if ('error' in settings) return settings
    const props = updateLiveEffect(renderer, found.node, settings)
    if (!props) return { error: `Nothing is left of ${found.node.name} after that edit` }
    figma.graph.updateNode(found.node.id, props)
    const node = figma.graph.getNode(found.node.id)
    const effect = node && pathEffectOf(node)
    return node && effect ? describe(node, effect) : { id: found.node.id }
  }
})

export const expandPathEffect = defineTool({
  name: 'expand_path_effect',
  description:
    "Expand live warps, envelope meshes, or width profiles (Illustrator's Object → Expand): each layer keeps the shape it has as an ordinary vector, and the effect and the outline it kept are dropped.",
  execution: { kind: 'sync', mutation: 'document' },
  input: v.strictObject({ ids: v.pipe(v.array(v.string()), v.minLength(1)) }),
  execute: (figma, { ids }) => {
    const expanded: string[] = []
    for (const id of ids) {
      const found = liveLayer(figma, id)
      if ('error' in found) return found
      const props = expandLiveEffect(found.node)
      if (props) figma.graph.updateNode(found.node.id, props)
      expanded.push(found.node.id)
    }
    return { expanded }
  }
})

export const releasePathEffect = defineTool({
  name: 'release_path_effect',
  description:
    "Release live warps, envelope meshes, or width profiles (Illustrator's Object → Envelope Distort → Release): each layer goes back to the outline the effect reshaped, painted as it is; a width profile goes back to its centre line stroked with its paint at its weight.",
  execution: { kind: 'sync', mutation: 'document' },
  input: v.strictObject({ ids: v.pipe(v.array(v.string()), v.minLength(1)) }),
  execute: (figma, { ids }) => {
    const renderer = measuringRenderer(figma)
    if (!renderer) return { error: NO_RENDERER }
    const created: { id: string; name: string; source: string }[] = []
    for (const id of ids) {
      const found = liveLayer(figma, id)
      if ('error' in found) return found
      const props = releaseLiveEffect(renderer, found.node)
      if (!props) return { error: `${found.node.name} cannot be released` }
      const madeId = replaceWithVector(figma.graph, found.node, props)
      if (madeId) created.push({ id: madeId, name: String(props.name), source: found.node.id })
    }
    return { created }
  }
})
