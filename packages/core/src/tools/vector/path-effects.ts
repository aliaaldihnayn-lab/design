import * as v from 'valibot'

import type { Fill, SceneNode } from '@lawha/scene-graph'

import { applyLiveEffect } from '#core/canvas/live-effects'
import { outlineStrokeLayer, type OutlinePiece } from '#core/canvas/outline-stroke'
import {
  canTakePathEffect,
  offsetPathProps,
  widthProfileProps,
  widthStroke
} from '#core/canvas/path-effects'
import { BLACK } from '#core/constants'
import type { FigmaAPI } from '#core/figma-api'
import { measuringRenderer } from '#core/figma-api/measure'
import { defineTool } from '#core/tools/schema'
import { profileWidthPoints, WIDTH_PROFILES } from '#core/vector/width'

const NO_RENDERER = 'Path effects need path geometry, which this host cannot measure'

function layer(figma: FigmaAPI, id: string) {
  const node = figma.graph.getNode(id)
  if (!node) return { error: `Node ${id} not found` }
  if (!canTakePathEffect(node, figma.graph))
    return { error: `${node.name} has no outline (shapes, vectors, text, booleans)` }
  return { node }
}

/** Inserts a vector made from `props` next to `node`: just under it, or just over it. */
function insertBeside(figma: FigmaAPI, node: SceneNode, props: Partial<SceneNode>, above: boolean) {
  const parentId = node.parentId
  const parent = parentId ? figma.graph.getNode(parentId) : undefined
  if (!parentId || !parent) return null
  const index = parent.childIds.indexOf(node.id)
  const vector = figma.graph.createNode('VECTOR', parentId, props)
  figma.graph.insertChildAt(vector.id, parentId, above ? index + 1 : index)
  return vector.id
}

export const offsetPath = defineTool({
  name: 'offset_path',
  description:
    "Illustrator's Object → Path → Offset Path: a new vector of each layer's outline grown by distance pixels (shrunk when negative), with miter, round, or bevel joins, painted like the layer and placed just under it. The original stays.",
  execution: { kind: 'sync', mutation: 'document' },
  input: v.strictObject({
    ids: v.pipe(v.array(v.string()), v.minLength(1)),
    distance: v.pipe(v.number(), v.minValue(-1000), v.maxValue(1000), v.description('Pixels')),
    join: v.optional(v.picklist(['MITER', 'ROUND', 'BEVEL']), 'MITER'),
    miter_limit: v.optional(v.pipe(v.number(), v.minValue(1), v.maxValue(100)), 4)
  }),
  execute: (figma, { ids, distance, join, miter_limit }) => {
    const renderer = measuringRenderer(figma)
    if (!renderer) return { error: NO_RENDERER }
    const created: { id: string; name: string }[] = []
    for (const id of ids) {
      const found = layer(figma, id)
      if ('error' in found) return found
      const props = offsetPathProps(renderer, figma.graph, found.node, distance, join, miter_limit)
      if (!props) continue
      const madeId = insertBeside(figma, found.node, props, false)
      if (madeId) created.push({ id: madeId, name: String(props.name) })
    }
    if (created.length === 0) return { error: 'Nothing is left after that offset' }
    return { created }
  }
})

export const widthProfile = defineTool({
  name: 'width_profile',
  description: `Illustrator's Width tool, expanded: each layer's stroke becomes a filled vector whose width varies along the path, by a preset profile (${WIDTH_PROFILES.join(', ')}) or by width points (t 0…1 along the path, width as a multiple of the stroke weight). A layer with a fill keeps it, without its stroke; a layer with only a stroke is replaced. The profile stays live, as the Width tool leaves it (edit_path_effect changes its points, expand_path_effect and release_path_effect end it), unless expand is true.`,
  execution: { kind: 'sync', mutation: 'document' },
  input: v.strictObject({
    ids: v.pipe(v.array(v.string()), v.minLength(1)),
    profile: v.optional(v.picklist(WIDTH_PROFILES), 'taper-both'),
    points: v.optional(
      v.pipe(
        v.array(
          v.strictObject({
            t: v.pipe(v.number(), v.minValue(0), v.maxValue(1)),
            width: v.pipe(v.number(), v.minValue(0), v.maxValue(20))
          })
        ),
        v.minLength(1),
        v.maxLength(32),
        v.description('Width points; they override profile')
      )
    ),
    expand: v.optional(v.pipe(v.boolean(), v.description('Expand at once: no live profile')), false)
  }),
  execute: (figma, { ids, profile, points, expand }) => {
    const renderer = measuringRenderer(figma)
    if (!renderer) return { error: NO_RENDERER }
    const widths = points ?? profileWidthPoints(profile)
    const created: { id: string; name: string }[] = []
    for (const id of ids) {
      const found = layer(figma, id)
      if ('error' in found) return found
      const { node } = found
      const weight = widthStroke(node)?.weight ?? 0
      const props = expand
        ? widthProfileProps(renderer, figma.graph, node, widths)
        : applyLiveEffect(renderer, figma.graph, node, { kind: 'width', weight, points: widths })
      if (!props) return { error: `${node.name} has no visible stroke` }
      const madeId = insertBeside(figma, node, props, true)
      if (!madeId) continue
      created.push({ id: madeId, name: String(props.name) })
      if (node.fills.some((fill) => fill.visible)) figma.graph.updateNode(node.id, { strokes: [] })
      else figma.graph.deleteNode(node.id)
    }
    return { created }
  }
})

export const outlineStroke = defineTool({
  name: 'outline_stroke',
  description:
    "Outline stroke (Illustrator's Object → Path → Outline Stroke): each stroked layer is replaced by its fill as a vector under its stroke as a filled vector.",
  execution: { kind: 'sync', mutation: 'document' },
  input: v.strictObject({ ids: v.pipe(v.array(v.string()), v.minLength(1)) }),
  execute: (figma, { ids }) => {
    const renderer = measuringRenderer(figma)
    if (!renderer) return { error: NO_RENDERER }
    const created: { id: string; name: string }[] = []
    for (const id of ids) {
      const node = figma.graph.getNode(id)
      if (!node) return { error: `Node ${id} not found` }
      const outlined = outlineStrokeLayer(renderer, node, figma.graph)
      const parentId = node.parentId
      if (!outlined || !parentId) return { error: `${node.name} has no visible stroke` }
      const index = figma.graph.getNode(parentId)?.childIds.indexOf(node.id) ?? 0
      const pieces = [outlined.fill, outlined.stroke].filter(
        (piece): piece is OutlinePiece => piece !== null
      )
      for (const [offset, piece] of pieces.entries()) {
        const made = figma.graph.createNode(piece.type, parentId, piece.props)
        for (const child of piece.children) figma.graph.createNode('VECTOR', made.id, child)
        figma.graph.insertChildAt(made.id, parentId, index + offset)
        created.push({ id: made.id, name: made.name })
      }
      figma.graph.deleteNode(node.id)
    }
    return { created }
  }
})

export const setPatternFill = defineTool({
  name: 'set_pattern_fill',
  description:
    "Fill layers with a pattern tiled from another layer (Illustrator's pattern swatches, Figma's pattern fill): the source layer or component is drawn repeatedly, scaled, with spacing as a fraction of the tile, in a rectangular or hexagonal grid, moved by offset_x and offset_y pixels and turned by rotation degrees about the layer's middle. Replaces the layers' fills unless keep_fills is true, which adds the pattern on top.",
  execution: { kind: 'sync', mutation: 'document' },
  input: v.strictObject({
    ids: v.pipe(v.array(v.string()), v.minLength(1)),
    source_id: v.pipe(v.string(), v.description('The layer to tile')),
    scale: v.optional(v.pipe(v.number(), v.minValue(0.01), v.maxValue(100)), 1),
    spacing_x: v.optional(v.pipe(v.number(), v.minValue(0), v.maxValue(10)), 0),
    spacing_y: v.optional(v.pipe(v.number(), v.minValue(0), v.maxValue(10)), 0),
    tile_type: v.optional(
      v.picklist(['RECTANGULAR', 'HORIZONTAL_HEXAGONAL', 'VERTICAL_HEXAGONAL']),
      'RECTANGULAR'
    ),
    offset_x: v.optional(v.pipe(v.number(), v.minValue(-100_000), v.maxValue(100_000)), 0),
    offset_y: v.optional(v.pipe(v.number(), v.minValue(-100_000), v.maxValue(100_000)), 0),
    rotation: v.optional(v.pipe(v.number(), v.minValue(-360), v.maxValue(360)), 0),
    keep_fills: v.optional(v.boolean(), false)
  }),
  execute: (figma, args) => {
    const source = figma.graph.getNode(args.source_id)
    if (!source) return { error: `Node ${args.source_id} not found` }
    if (source.width <= 0 || source.height <= 0)
      return { error: `${source.name} has no size to tile` }
    const pattern: Fill = {
      type: 'PATTERN',
      color: { ...BLACK },
      opacity: 1,
      visible: true,
      sourceNodeId: source.id,
      scale: args.scale,
      patternSpacing: { x: args.spacing_x, y: args.spacing_y },
      patternTileType: args.tile_type,
      patternOffset: { x: args.offset_x, y: args.offset_y },
      patternRotation: args.rotation,
      horizontalAlignment: 'START',
      verticalAlignment: 'START'
    }
    const updated: string[] = []
    for (const id of args.ids) {
      const node = figma.graph.getNode(id)
      if (!node) return { error: `Node ${id} not found` }
      if (node.id === source.id) return { error: 'A layer cannot be filled with itself' }
      const fills = args.keep_fills ? [...node.fills, pattern] : [pattern]
      figma.graph.updateNode(node.id, { fills: fills.map((fill) => ({ ...fill })) })
      updated.push(node.id)
    }
    return { updated, source_id: source.id }
  }
})
