import { readPsd, type Layer, type Psd } from 'ag-psd'
import type { CanvasKit } from 'canvaskit-wasm'

import { SceneGraph, type Fill, type SceneNode } from '@lawha/scene-graph'
import { BLACK } from '@lawha/scene-graph/constants'
import { computeImageHash } from '@lawha/scene-graph/images'
import type { Vector } from '@lawha/scene-graph/primitives'

import { getCanvasKit } from '#core/canvaskit'
import { parsePDFFontName } from '#core/io/formats/pdf/import/font-name'
import { createCanvasKitRasterCodec } from '#core/io/formats/raster'

import { psdColor } from './color'
import { layerStyle, psdBlendMode, type LayerStyle } from './effects'
import { preparePSDRuntime } from './runtime'
import { addShapeLayer, isEditableShapeLayer } from './shapes'

/**
 * Photoshop and Affinity `.psd`/`.psb` files as editable layers: one frame the size of the
 * canvas, groups as frames without a fill, pixel layers as images at their exact position,
 * text layers as live text and shape and fill layers as shapes (with their pixels hidden
 * underneath, so nothing is lost if a font or a shape cannot be redrawn), layer styles (shadows,
 * glows, strokes, overlays) as effects, and layer opacity, visibility and blend modes kept.
 */
export interface PSDReadOptions {
  canvasKit?: CanvasKit
  name?: string
}

interface Context {
  graph: SceneGraph
  canvas: { width: number; height: number }
  encode: (pixels: ImageDataLike) => Uint8Array | null
  /** The document's light angle, which layer styles that use global light take. */
  globalAngle: number
}

interface ImageDataLike {
  width: number
  height: number
  data: Uint8ClampedArray | Uint8Array | Uint16Array | Float32Array
}

/** 8-bit RGBA from any PSD depth: 16-bit channels drop their low byte, 32-bit float is 0–1. */
function toRGBA8(data: ImageDataLike['data']): Uint8Array {
  if (data instanceof Uint8Array || data instanceof Uint8ClampedArray) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  }
  const out = new Uint8Array(data.length)
  const scale = data instanceof Uint16Array ? 1 / 257 : 255
  for (let i = 0; i < data.length; i++)
    out[i] = Math.max(0, Math.min(255, Math.round(data[i] * scale)))
  return out
}

function imageFill(ctx: Context, pixels: ImageDataLike): Fill | null {
  const png = ctx.encode(pixels)
  if (!png) return null
  const hash = computeImageHash(png)
  ctx.graph.images.set(hash, png)
  return {
    type: 'IMAGE',
    imageHash: hash,
    imageScaleMode: 'FILL',
    color: { ...BLACK },
    opacity: 1,
    visible: true
  }
}

function common(layer: Layer) {
  return {
    name: layer.name ?? 'Layer',
    visible: !layer.hidden,
    opacity: layer.opacity ?? 1,
    blendMode:
      layer.blendMode === 'pass through'
        ? 'PASS_THROUGH'
        : (psdBlendMode(layer.blendMode) ?? 'NORMAL')
  }
}

function bounds(layer: Layer) {
  const x = layer.left ?? 0
  const y = layer.top ?? 0
  return {
    x,
    y,
    width: Math.max(1, (layer.right ?? x) - x),
    height: Math.max(1, (layer.bottom ?? y) - y)
  }
}

function addText(ctx: Context, parentId: string, layer: Layer, origin: Vector, style: LayerStyle) {
  const text = layer.text
  if (!text) return
  const box = bounds(layer)
  const scale = Math.abs(text.transform?.[3] ?? 1) || 1
  const size = (text.style?.fontSize ?? 16) * scale
  const face = text.style?.font?.name ? parsePDFFontName(text.style.font.name) : null
  const fill: Fill = {
    type: 'SOLID',
    color: psdColor(text.style?.fillColor),
    opacity: layer.fillOpacity ?? 1,
    visible: true
  }
  ctx.graph.createNode('TEXT', parentId, {
    ...common(layer),
    x: box.x - origin.x,
    y: box.y - origin.y,
    width: box.width,
    height: box.height,
    text: text.text.replace(/\r/g, '\n'),
    fontFamily: face?.family ?? 'Inter',
    fontSize: Math.round(size * 100) / 100,
    fontWeight: face?.weight ?? 400,
    italic: face?.italic ?? false,
    textAutoResize: 'NONE',
    textDirection: /[֐-ࣿ]/.test(text.text) ? 'RTL' : 'LTR',
    fills: [fill, ...style.overlays],
    strokes: style.strokes,
    effects: style.effects
  })
}

function addLayer(ctx: Context, parentId: string, layer: Layer, origin: Vector) {
  if (layer.children) {
    // A group covers the canvas, so its layers keep their canvas coordinates.
    const group = ctx.graph.createNode('FRAME', parentId, {
      ...common(layer),
      x: -origin.x,
      y: -origin.y,
      width: ctx.canvas.width,
      height: ctx.canvas.height,
      fills: [],
      clipsContent: false
    })
    for (const child of layer.children) addLayer(ctx, group.id, child, { x: 0, y: 0 })
    return
  }
  const pixels = layer.imageData
  const style = layerStyle(layer.effects, ctx.globalAngle)
  if (layer.text) {
    // The rendered text stays underneath, hidden, as the exact look if a font is missing.
    if (pixels) addPixels(ctx, parentId, layer, pixels, origin, false)
    addText(ctx, parentId, layer, origin, style)
    return
  }
  if (isEditableShapeLayer(layer)) {
    // So does a shape's, in case it cannot be redrawn exactly (a boolean of paths, say).
    if (pixels) addPixels(ctx, parentId, layer, pixels, origin, false)
    const shape = addShapeLayer(
      ctx.graph,
      parentId,
      layer,
      { ...common(layer), effects: style.effects },
      ctx.canvas
    )
    if (shape) {
      ctx.graph.updateNode(shape.id, {
        x: shape.x - origin.x,
        y: shape.y - origin.y,
        fills: [...shape.fills, ...style.overlays],
        strokes: [...shape.strokes, ...style.strokes]
      })
      return
    }
  }
  // Pixels cast shadows and glows from what they draw. A stroke or overlay would outline or
  // cover their whole box rather than what they draw, so a pixel layer goes without those.
  if (pixels) addPixels(ctx, parentId, layer, pixels, origin, !layer.hidden, style.effects)
}

function addPixels(
  ctx: Context,
  parentId: string,
  layer: Layer,
  pixels: ImageDataLike,
  origin: Vector,
  visible: boolean,
  effects: SceneNode['effects'] = []
) {
  if (pixels.width === 0 || pixels.height === 0) return
  const fill = imageFill(ctx, pixels)
  if (!fill) return
  const box = bounds(layer)
  ctx.graph.createNode('RECTANGLE', parentId, {
    ...common(layer),
    name: layer.text ? `${layer.name ?? 'Text'} (pixels)` : (layer.name ?? 'Layer'),
    visible,
    x: box.x - origin.x,
    y: box.y - origin.y,
    width: pixels.width,
    height: pixels.height,
    fills: [fill],
    effects
  })
}

export async function readPSDDocument(
  bytes: Uint8Array,
  options: PSDReadOptions = {}
): Promise<SceneGraph> {
  preparePSDRuntime()
  const psd: Psd = readPsd(bytes, {
    useImageData: true,
    skipThumbnail: true,
    skipCompositeImageData: false
  })
  const ck = options.canvasKit ?? (await getCanvasKit())
  const codec = createCanvasKitRasterCodec(ck)
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  const ctx: Context = {
    graph,
    canvas: { width: psd.width, height: psd.height },
    encode: (pixels) =>
      codec.encodePNG({
        width: pixels.width,
        height: pixels.height,
        data: toRGBA8(pixels.data)
      }),
    globalAngle: psd.imageResources?.globalAngle ?? 120
  }
  const frame = graph.createNode('FRAME', page.id, {
    name: options.name ?? 'Photoshop document',
    x: 0,
    y: 0,
    width: psd.width,
    height: psd.height,
    fills: [],
    clipsContent: true
  })
  if (psd.children && psd.children.length > 0) {
    for (const layer of psd.children) addLayer(ctx, frame.id, layer, { x: 0, y: 0 })
  } else if (psd.imageData) {
    // A flattened file: the composite is the one layer.
    addPixels(ctx, frame.id, { name: 'Background' }, psd.imageData, { x: 0, y: 0 }, true)
  }
  return graph
}
