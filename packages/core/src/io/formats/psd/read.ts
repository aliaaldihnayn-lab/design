import { readPsd, type Layer, type Psd } from 'ag-psd'
import type { CanvasKit } from 'canvaskit-wasm'

import { SceneGraph, type BlendMode, type Fill } from '@lawha/scene-graph'
import { BLACK } from '@lawha/scene-graph/constants'
import { computeImageHash } from '@lawha/scene-graph/images'
import type { Vector } from '@lawha/scene-graph/primitives'

import { getCanvasKit } from '#core/canvaskit'
import { createCanvasKitRasterCodec } from '#core/io/formats/raster'

import { preparePSDRuntime } from './runtime'

/**
 * Photoshop and Affinity `.psd`/`.psb` files as editable layers: one frame the size of the
 * canvas, groups as frames without a fill, pixel layers as images at their exact position,
 * text layers as live text (with their pixels hidden underneath, so nothing is lost if a font
 * is missing), and layer opacity, visibility and blend modes kept.
 */
export interface PSDReadOptions {
  canvasKit?: CanvasKit
  name?: string
}

const BLEND_MODES: Record<string, BlendMode> = {
  normal: 'NORMAL',
  'pass through': 'PASS_THROUGH',
  multiply: 'MULTIPLY',
  screen: 'SCREEN',
  overlay: 'OVERLAY',
  darken: 'DARKEN',
  lighten: 'LIGHTEN',
  'color dodge': 'COLOR_DODGE',
  'color burn': 'COLOR_BURN',
  'hard light': 'HARD_LIGHT',
  'soft light': 'SOFT_LIGHT',
  difference: 'DIFFERENCE',
  exclusion: 'EXCLUSION',
  hue: 'HUE',
  saturation: 'SATURATION',
  color: 'COLOR',
  luminosity: 'LUMINOSITY',
  'linear burn': 'LINEAR_BURN',
  'linear dodge': 'LINEAR_DODGE'
}

interface Context {
  graph: SceneGraph
  canvas: { width: number; height: number }
  encode: (pixels: ImageDataLike) => Uint8Array | null
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
    blendMode: BLEND_MODES[layer.blendMode ?? 'normal'] ?? 'NORMAL'
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

/** A PSD colour (0–255 channels) as a scene colour. */
function textColor(layer: Layer) {
  const fill = layer.text?.style?.fillColor
  if (fill && 'r' in fill) return { r: fill.r / 255, g: fill.g / 255, b: fill.b / 255, a: 1 }
  return { ...BLACK }
}

function addText(ctx: Context, parentId: string, layer: Layer, origin: Vector) {
  const text = layer.text
  if (!text) return
  const box = bounds(layer)
  const scale = Math.abs(text.transform?.[3] ?? 1) || 1
  const size = (text.style?.fontSize ?? 16) * scale
  const family = text.style?.font?.name.replace(/-.*$/, '') ?? 'Inter'
  ctx.graph.createNode('TEXT', parentId, {
    ...common(layer),
    x: box.x - origin.x,
    y: box.y - origin.y,
    width: box.width,
    height: box.height,
    text: text.text.replace(/\r/g, '\n'),
    fontFamily: family,
    fontSize: Math.round(size * 100) / 100,
    fontWeight: /bold/i.test(text.style?.font?.name ?? '') ? 700 : 400,
    textAutoResize: 'NONE',
    textDirection: /[֐-ࣿ]/.test(text.text) ? 'RTL' : 'LTR',
    fills: [{ type: 'SOLID', color: textColor(layer), opacity: 1, visible: true }]
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
  if (layer.text) {
    // The rendered text stays underneath, hidden, as the exact look if a font is missing.
    if (pixels) addPixels(ctx, parentId, layer, pixels, origin, false)
    addText(ctx, parentId, layer, origin)
    return
  }
  if (pixels) addPixels(ctx, parentId, layer, pixels, origin, !layer.hidden)
}

function addPixels(
  ctx: Context,
  parentId: string,
  layer: Layer,
  pixels: ImageDataLike,
  origin: Vector,
  visible: boolean
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
    fills: [fill]
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
      })
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
