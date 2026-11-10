import * as v from 'valibot'

import type { SceneNode } from '@lawha/scene-graph'
import { colorToHex, parseColor } from '@lawha/scene-graph/color'
import type { Vector } from '@lawha/scene-graph/primitives'

import { BLACK } from '#core/constants'
import { loadPixelSurface, paintedLayerChanges, type PixelSurface } from '#core/editor/pixels/layer'
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
import { compositeOver } from '#core/pixels/composite'
import { fillRegion, pixelColor, selectSimilar } from '#core/pixels/fill'
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
  figma.graph.updateNode(node.id, paintedLayerChanges(node, surface.paintIndex, hash))
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
    "Fill bucket: fill the area of pixels like the one at (x, y), as the layer shows them, with a colour, into the layer's paint layer (non-destructive). x and y are in the layer's own coordinates; tolerance 0–1 (default 0.15); contiguous false fills every like pixel in the layer.",
  execution: { kind: 'sync', mutation: 'document' },
  input: v.strictObject({
    id: nodeIdInputSchema,
    x: toolNumber(),
    y: toolNumber(),
    color: v.pipe(v.string(), v.description('Fill colour (hex)')),
    tolerance: unitSchema,
    contiguous: v.optional(v.boolean(), true),
    opacity: unitSchema
  }),
  execute: (figma, args) => {
    const loaded = loadForTool(figma, args.id)
    if ('error' in loaded) return loaded
    const { node, surface, codec } = loaded
    const at = toGrid(node, surface, args)
    const shown = compositeOver(surface.base, surface.paint)
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
    'Colour picker: the colour a shape or frame shows at (x, y) in its own coordinates, from its solid and image fills and paint layer, as hex with alpha 0–1.',
  execution: { kind: 'sync', mutation: 'none' },
  input: v.strictObject({ id: nodeIdInputSchema, x: toolNumber(), y: toolNumber() }),
  execute: (figma, args) => {
    const loaded = loadForTool(figma, args.id)
    if ('error' in loaded) return loaded
    const { node, surface } = loaded
    const at = toGrid(node, surface, args)
    const color = pixelColor(compositeOver(surface.base, surface.paint), at.x, at.y)
    if (!color) return { error: 'That point is outside the layer' }
    return { hex: colorToHex(color), alpha: color.a }
  }
})
