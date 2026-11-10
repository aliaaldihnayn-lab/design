import * as v from 'valibot'

import type { Fill, SceneNode } from '@lawha/scene-graph'

import { buildVectorFrame } from '#core/editor/vectorize'
import { measuringRenderer } from '#core/figma-api/measure'
import { defineTool } from '#core/tools/schema'
import {
  svgToVectorPaths,
  traceImage,
  tracePixelsFromImage,
  traceToSVG,
  type TraceOptions
} from '#core/vector/vectorize'

/** How finely each detail level reads the image: its longest side, and how close paths stay. */
export const TRACE_DETAIL = {
  low: { maxSide: 256, tolerance: 1.5, noise: 16 },
  medium: { maxSide: 512, tolerance: 1, noise: 8 },
  high: { maxSide: 1024, tolerance: 0.6, noise: 4 }
} as const

export type TraceDetail = keyof typeof TRACE_DETAIL

/** The image fill of a layer that is only an image, as the vectorize command takes it. */
export function traceableImageFill(node: SceneNode): Fill | null {
  if (node.type !== 'RECTANGLE' || node.childIds.length > 0 || node.fills.length !== 1) return null
  const fill = node.fills[0]
  return fill.type === 'IMAGE' && fill.imageHash ? fill : null
}

/** The trace settings for a detail level, with the colour count and any noise given. */
export function traceSettings(detail: TraceDetail, colors: number, noise?: number) {
  const level = TRACE_DETAIL[detail]
  const options: Partial<TraceOptions> = {
    colors,
    tolerance: level.tolerance,
    noise: noise ?? level.noise
  }
  return { maxSide: level.maxSide, options }
}

export const imageTrace = defineTool({
  name: 'image_trace',
  description:
    "Trace an image layer into editable vector shapes on this device, as Illustrator's Image Trace: the image is reduced to a few colours, specks are absorbed, and each colour's areas become smooth paths stacked largest first, in a frame that replaces the image. No network or API key is used.",
  execution: { kind: 'sync', mutation: 'document' },
  input: v.strictObject({
    id: v.pipe(v.string(), v.description('A rectangle whose only fill is an image')),
    colors: v.optional(
      v.pipe(
        v.number(),
        v.integer(),
        v.minValue(2),
        v.maxValue(32),
        v.description('Colours, 2–32')
      ),
      8
    ),
    detail: v.optional(v.picklist(['low', 'medium', 'high']), 'medium'),
    noise: v.optional(
      v.pipe(
        v.number(),
        v.integer(),
        v.minValue(0),
        v.maxValue(500),
        v.description('Patches smaller than this many pixels are absorbed')
      )
    )
  }),
  execute: (figma, { id, colors, detail, noise }) => {
    const node = figma.graph.getNode(id)
    if (!node) return { error: `Node ${id} not found` }
    const fill = traceableImageFill(node)
    if (!fill?.imageHash) return { error: `${node.name} is not an image layer` }
    const bytes = figma.graph.images.get(fill.imageHash)
    if (!bytes) return { error: 'Image data is missing for this layer' }
    const renderer = measuringRenderer(figma)
    if (!renderer) return { error: 'Image Trace needs CanvasKit to decode the image' }
    const { maxSide, options } = traceSettings(detail, colors, noise)
    const pixels = tracePixelsFromImage(renderer.ck, bytes, maxSide)
    if (!pixels) return { error: 'The image could not be decoded' }
    const traced = traceImage(pixels, options)
    const vectorized = svgToVectorPaths(traceToSVG(traced), {
      width: node.width,
      height: node.height
    })
    if (!vectorized?.paths.length) return { error: 'The trace found no shapes' }
    const frameId = buildVectorFrame(figma.graph, node, vectorized)
    if (!frameId) return { error: 'Could not replace this image with vector layers' }
    figma.graph.deleteNode(node.id)
    return {
      id: frameId,
      colors: traced.layers.length,
      paths: figma.graph.getNode(frameId)?.childIds.length ?? 0
    }
  }
})
