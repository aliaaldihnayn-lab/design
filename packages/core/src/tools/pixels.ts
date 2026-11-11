import * as v from 'valibot'

import type { SceneNode } from '@lawha/scene-graph'
import { colorToHex, parseColor } from '@lawha/scene-graph/color'
import type { Vector } from '@lawha/scene-graph/primitives'

import { BLACK } from '#core/constants'
import { loadPixelSurface, paintedLayerChanges, type PixelSurface } from '#core/editor/pixels/layer'
import { maskImage, maskLayerWith } from '#core/editor/pixels/select'
import type { FigmaAPI } from '#core/figma-api'
import { storeImage } from '#core/figma-api/images'
import type { RasterCodec } from '#core/io/formats/raster'
import {
  createStrokeCoverage,
  dabSpacing,
  eraseDab,
  paintDab,
  strokeDabs,
  type BrushTip
} from '#core/pixels/brush'
import { cloneDab } from '#core/pixels/clone'
import { compositeOver } from '#core/pixels/composite'
import { fillRegion, pixelColor, selectSimilar } from '#core/pixels/fill'
import { createHealingStroke, finishHealingStroke, healDab } from '#core/pixels/heal'
import {
  ellipseMask,
  featherMask,
  invertMask,
  maskBounds,
  rectMask,
  type PixelMask
} from '#core/pixels/mask'
import { defineTool, nodeIdInputSchema, toolNumber } from '#core/tools/schema'

const pointSchema = v.strictObject({ x: v.number(), y: v.number() })
const unitSchema = v.optional(toolNumber(v.pipe(v.number(), v.minValue(0), v.maxValue(1))))

type Loaded = { node: SceneNode; surface: PixelSurface; codec: RasterCodec } | { error: string }

/** The layer and its pixels, or why the pixel tools cannot work on it. */
export function loadForTool(figma: FigmaAPI, id: string): Loaded {
  const node = figma.graph.getNode(id)
  if (!node) return { error: `Node ${id} not found` }
  const codec = figma.rasterCodec
  if (!codec) return { error: 'Pixel editing needs an image codec, which this host lacks' }
  const surface = loadPixelSurface(figma.graph, codec, node)
  if (!surface) return { error: `${node.type} layers cannot be painted on; use a shape or frame` }
  return { node, surface, codec }
}

/** Layer-local coordinates in the layer's pixel grid. */
export function toGrid(node: SceneNode, surface: PixelSurface, point: Vector): Vector {
  return {
    x: (point.x / node.width) * surface.width,
    y: (point.y / node.height) * surface.height
  }
}

const sampleSchema = v.optional(
  v.pipe(
    v.picklist(['layer', 'all']),
    v.description('Read the layer as drawn by itself (layer) or with every layer on the page (all)')
  ),
  'layer'
)

/**
 * What the layer shows on its pixel grid as the renderer draws it (gradients, adjustments,
 * effects), from the layer alone or every layer; its solid and image fills without a renderer.
 */
async function shownForTool(
  figma: FigmaAPI,
  node: SceneNode,
  surface: PixelSurface,
  scope: 'layer' | 'all'
) {
  const rendered = figma.renderLayerGrid
    ? await figma.renderLayerGrid(node.id, surface, scope)
    : null
  return rendered ?? compositeOver(surface.base, surface.paint)
}

/** Saves the paint layer back onto the layer. */
export function savePaint(
  figma: FigmaAPI,
  node: SceneNode,
  surface: PixelSurface,
  codec: RasterCodec
) {
  const png = codec.encodePNG(surface.paint)
  if (!png) return { error: 'Could not encode the paint layer' }
  const hash = storeImage(figma.graph, png)
  figma.graph.updateNode(node.id, paintedLayerChanges(node, surface, hash))
  return null
}

export const paintPixels = defineTool({
  name: 'paint_pixels',
  description:
    "Paint or erase freehand on a shape or frame, as Affinity Photo's brush and eraser do, non-destructively: strokes go into a paint layer (an image fill kept on top of the layer's own fills, reused by later strokes), so the original image stays. Points are in the layer's own coordinates (0,0 is its top-left); one point paints a dab. size is the brush diameter in the paint layer's pixels (as fine as the photo under it, up to 4 per unit).",
  execution: { kind: 'sync', mutation: 'document' },
  input: v.strictObject({
    id: nodeIdInputSchema,
    tool: v.optional(v.picklist(['brush', 'eraser']), 'brush'),
    points: v.pipe(v.array(pointSchema), v.minLength(1), v.maxLength(2000)),
    color: v.optional(v.pipe(v.string(), v.description('Brush colour (hex); default black'))),
    size: v.optional(toolNumber(v.pipe(v.number(), v.minValue(1), v.maxValue(2000))), 24),
    hardness: unitSchema,
    opacity: unitSchema
  }),
  execute: (figma, args) => {
    const loaded = loadForTool(figma, args.id)
    if ('error' in loaded) return loaded
    const { node, surface, codec } = loaded
    const tip: BrushTip = {
      size: args.size,
      hardness: args.hardness ?? 0.8,
      opacity: args.opacity ?? 1
    }
    const color = args.color ? parseColor(args.color) : { ...BLACK }
    const before = surface.paint.data.slice()
    const coverage = createStrokeCoverage(surface.paint)
    const dab = (at: Vector) => {
      if (args.tool === 'eraser') eraseDab(surface.paint, before, coverage, at, tip)
      else paintDab(surface.paint, before, coverage, at, tip, color)
    }
    const points = args.points.map((point) => toGrid(node, surface, point))
    let carry = 0
    dab(points[0])
    for (let i = 1; i < points.length; i++) {
      const stroke = strokeDabs(points[i - 1], points[i], dabSpacing(tip), carry)
      for (const centre of stroke.dabs) dab(centre)
      carry = stroke.carry
    }
    const failure = savePaint(figma, node, surface, codec)
    if (failure) return failure
    return { id: node.id, grid: { width: surface.width, height: surface.height } }
  }
})

export const fillPixels = defineTool({
  name: 'fill_pixels',
  description:
    "Fill bucket: fill the area of pixels like the one at (x, y), as the layer shows them, with a colour, into the layer's paint layer (non-destructive). x and y are in the layer's own coordinates; tolerance 0–1 (default 0.15); contiguous false fills every like pixel in the layer. sample all reads every layer on the page there, not the layer alone.",
  execution: { kind: 'async', mutation: 'document' },
  input: v.strictObject({
    id: nodeIdInputSchema,
    x: toolNumber(),
    y: toolNumber(),
    color: v.pipe(v.string(), v.description('Fill colour (hex)')),
    tolerance: unitSchema,
    contiguous: v.optional(v.boolean(), true),
    opacity: unitSchema,
    sample: sampleSchema
  }),
  execute: async (figma, args) => {
    const loaded = loadForTool(figma, args.id)
    if ('error' in loaded) return loaded
    const { node, surface, codec } = loaded
    const at = toGrid(node, surface, args)
    const shown = await shownForTool(figma, node, surface, args.sample)
    const region = selectSimilar(shown, at.x, at.y, args.tolerance ?? 0.15, args.contiguous)
    const filled = fillRegion(surface.paint, region, parseColor(args.color), args.opacity ?? 1)
    if (filled === 0) return { error: 'That point is outside the layer' }
    const failure = savePaint(figma, node, surface, codec)
    if (failure) return failure
    return { id: node.id, filled_pixels: filled }
  }
})

export const samplePixelColor = defineTool({
  name: 'sample_pixel_color',
  description:
    'Colour picker: the colour a shape or frame shows at (x, y) in its own coordinates, as the canvas draws it (gradients, image adjustments, effects, paint), as hex with alpha 0–1. sample all reads every layer on the page there.',
  execution: { kind: 'async', mutation: 'none' },
  input: v.strictObject({
    id: nodeIdInputSchema,
    x: toolNumber(),
    y: toolNumber(),
    sample: sampleSchema
  }),
  execute: async (figma, args) => {
    const loaded = loadForTool(figma, args.id)
    if ('error' in loaded) return loaded
    const { node, surface } = loaded
    const at = toGrid(node, surface, args)
    const color = pixelColor(await shownForTool(figma, node, surface, args.sample), at.x, at.y)
    if (!color) return { error: 'That point is outside the layer' }
    return { hex: colorToHex(color), alpha: color.a }
  }
})

const rectSchema = v.strictObject({
  x: v.number(),
  y: v.number(),
  width: v.pipe(v.number(), v.minValue(0)),
  height: v.pipe(v.number(), v.minValue(0))
})

export const maskFromSelection = defineTool({
  name: 'mask_layer_from_selection',
  description:
    "Mask a shape or frame (such as a photo) with a pixel selection, as Affinity's New Mask Layer does: a mask layer of the selection's shape goes under it and both go in a group, hiding what lies outside. Select a rectangle or ellipse (rect, in the layer's own coordinates) or, with similar, the pixels like the one at point within tolerance 0–1 (magic wand). invert masks out the selection instead; feather softens the edge over that many of the layer's pixels. Returns the group.",
  execution: { kind: 'sync', mutation: 'document' },
  input: v.strictObject({
    id: nodeIdInputSchema,
    shape: v.picklist(['rect', 'ellipse', 'similar']),
    rect: v.optional(rectSchema),
    point: v.optional(pointSchema),
    tolerance: unitSchema,
    contiguous: v.optional(v.boolean(), true),
    invert: v.optional(v.boolean(), false),
    feather: v.optional(toolNumber(v.pipe(v.number(), v.minValue(0), v.maxValue(500))), 0)
  }),
  execute: (figma, args) => {
    const loaded = loadForTool(figma, args.id)
    if ('error' in loaded) return loaded
    const { node, surface, codec } = loaded
    let mask: PixelMask
    if (args.shape === 'similar') {
      if (!args.point) return { error: 'similar needs a point' }
      const at = toGrid(node, surface, args.point)
      const shown = compositeOver(surface.base, surface.paint)
      mask = selectSimilar(shown, at.x, at.y, args.tolerance ?? 0.15, args.contiguous)
    } else {
      if (!args.rect) return { error: `${args.shape} needs a rect` }
      const from = toGrid(node, surface, args.rect)
      const to = toGrid(node, surface, {
        x: args.rect.x + args.rect.width,
        y: args.rect.y + args.rect.height
      })
      const rect = { x: from.x, y: from.y, width: to.x - from.x, height: to.y - from.y }
      mask =
        args.shape === 'ellipse'
          ? ellipseMask(surface.width, surface.height, rect)
          : rectMask(surface.width, surface.height, rect)
    }
    if (!maskBounds(mask)) return { error: 'The selection is empty' }
    if (args.invert) mask = invertMask(mask)
    if (args.feather > 0) mask = featherMask(mask, args.feather)
    const png = codec.encodePNG(maskImage(mask))
    if (!png) return { error: 'Could not encode the mask' }
    if (!node.parentId) return { error: 'The layer is on no page' }
    const groupId = maskLayerWith(figma.graph, node, storeImage(figma.graph, png))
    return { group_id: groupId, layer_id: node.id }
  }
})

export const clonePixels = defineTool({
  name: 'clone_pixels',
  description:
    "Retouch a shape or frame (such as a photo) with Affinity's clone stamp or, with heal, its healing brush: paint along points, copying the layer as it shows from source, a point in the layer's own coordinates, at the same offset from the first point. heal keeps the copied texture but solves it into its surroundings (Poisson seamless cloning), so the patch takes the tone and shading around it with no seam, to hide blemishes. Goes into the paint layer, so the photo underneath is kept.",
  execution: { kind: 'sync', mutation: 'document' },
  input: v.strictObject({
    id: nodeIdInputSchema,
    source: pointSchema,
    points: v.pipe(v.array(pointSchema), v.minLength(1), v.maxLength(2000)),
    heal: v.optional(v.boolean(), false),
    size: v.optional(toolNumber(v.pipe(v.number(), v.minValue(1), v.maxValue(2000))), 24),
    hardness: unitSchema,
    opacity: unitSchema
  }),
  execute: (figma, args) => {
    const loaded = loadForTool(figma, args.id)
    if ('error' in loaded) return loaded
    const { node, surface, codec } = loaded
    const tip: BrushTip = {
      size: args.size,
      hardness: args.hardness ?? 0.5,
      opacity: args.opacity ?? 1
    }
    const points = args.points.map((point) => toGrid(node, surface, point))
    const source = toGrid(node, surface, args.source)
    const sampling = {
      source: compositeOver(surface.base, surface.paint),
      offset: { x: source.x - points[0].x, y: source.y - points[0].y }
    }
    const before = surface.paint.data.slice()
    const coverage = createStrokeCoverage(surface.paint)
    const healing = args.heal ? createHealingStroke(sampling) : null
    const dab = (at: Vector) =>
      healing
        ? healDab(surface.paint, before, coverage, at, tip, healing)
        : cloneDab(surface.paint, before, coverage, at, tip, sampling)
    let carry = 0
    dab(points[0])
    for (let i = 1; i < points.length; i++) {
      const stroke = strokeDabs(points[i - 1], points[i], dabSpacing(tip), carry)
      for (const centre of stroke.dabs) dab(centre)
      carry = stroke.carry
    }
    if (healing) finishHealingStroke(surface.paint, before, coverage, healing)
    const failure = savePaint(figma, node, surface, codec)
    if (failure) return failure
    return { id: node.id }
  }
})
