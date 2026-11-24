import { readPsd, type Layer, type PatternInfo, type Psd } from 'ag-psd'
import type { CanvasKit } from 'canvaskit-wasm'

import { SceneGraph, type Fill, type SceneNode } from '@lawha/scene-graph'
import { BLACK } from '@lawha/scene-graph/constants'
import { groupBounds } from '@lawha/scene-graph/group-bounds'
import { computeImageHash } from '@lawha/scene-graph/images'
import { parseSVGPath } from '@lawha/scene-graph/parse-path'
import { transformVectorNetwork } from '@lawha/scene-graph/vector-network'

import { getCanvasKit } from '#core/canvaskit'
import { createCanvasKitRasterCodec } from '#core/io/formats/raster'
import { computeAccurateBounds } from '#core/vector/curve-math'

import { layerStyle, psdBlendMode, type LayerStyle, type PatternFill } from './effects'
import { activeRasterMask, addRasterMask } from './masks'
import { pixelOutline } from './outline'
import { preparePSDRuntime } from './runtime'
import { addShapeLayer, addVectorMask, isEditableShapeLayer } from './shapes'
import { textPlacement, textProps } from './text'

/**
 * Photoshop and Affinity `.psd`/`.psb` files as editable layers: one frame the size of the
 * canvas, groups as frames without a fill, pixel layers as images at their exact position,
 * text layers as live text and shape and fill layers as shapes (with their pixels hidden
 * underneath, so nothing is lost if a font or a shape cannot be redrawn), boolean shapes as
 * boolean groups, pattern fills as tiled images, layer styles (shadows, glows, bevels, satin,
 * strokes, overlays) as effects and fills, and layer opacity, visibility and blend modes kept.
 * On a pixel layer, strokes and overlays follow the drawn pixels, on an outline traced from them.
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
  patternFill: PatternFill
  /** Frames standing in for groups while the layers are read, made groups once all are in. */
  groups: Set<string>
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

function common(layer: Layer, shown = !layer.hidden) {
  return {
    name: layer.name ?? 'Layer',
    visible: shown,
    opacity: layer.opacity ?? 1,
    blendMode:
      layer.blendMode === 'pass through'
        ? 'PASS_THROUGH'
        : (psdBlendMode(layer.blendMode) ?? 'NORMAL')
  } satisfies Partial<SceneNode>
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

function addText(ctx: Context, parentId: string, layer: Layer, shown: boolean, style: LayerStyle) {
  const text = layer.text
  if (!text) return
  const placed = textPlacement(text)
  const box = placed ?? { ...bounds(layer), rotation: 0, scale: 1 }
  const pointText = !placed || text.shapeType !== 'box'
  const props = textProps(text, box.scale, layer.fillOpacity ?? 1, pointText)
  ctx.graph.createNode('TEXT', parentId, {
    ...common(layer, shown),
    ...props,
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    rotation: box.rotation,
    fills: [...(props.fills ?? []), ...style.overlays],
    strokes: style.strokes,
    effects: style.effects
  })
}

/**
 * A group while layers are read into it: a frame over the canvas, so the layers keep their canvas
 * coordinates and nothing fits it, or the groups around it, to what it holds so far.
 */
function stageGroup(ctx: Context, parentId: string, props: Partial<SceneNode>): SceneNode {
  const frame = ctx.graph.createNode('FRAME', parentId, {
    ...props,
    x: 0,
    y: 0,
    width: ctx.canvas.width,
    height: ctx.canvas.height,
    fills: [],
    clipsContent: false
  })
  ctx.groups.add(frame.id)
  return frame
}

function depth(graph: SceneGraph, id: string): number {
  let count = 0
  for (let node = graph.getNode(id); node?.parentId; node = graph.getNode(node.parentId)) count++
  return count
}

/**
 * Turns the staged frames into groups fitted around what they show, innermost first, keeping
 * every layer where it is on the canvas, as Photoshop's groups have no box of their own.
 */
function finishGroups(ctx: Context) {
  const { graph } = ctx
  const staged = [...ctx.groups].sort((a, b) => depth(graph, b) - depth(graph, a))
  for (const id of staged) {
    const frame = expectNode(graph, id)
    const parentId = frame.parentId
    if (!parentId) continue
    const index = expectNode(graph, parentId).childIds.indexOf(id)
    const children = graph.getChildren(id)
    const box = groupBounds(graph, children, parentId, { x: 0, y: 0 })
    if (children.length === 0) {
      // An empty group has nothing to size it by and stays an empty frame in the layer list.
      graph.updateNode(id, box)
      continue
    }
    const group = graph.createNode('GROUP', parentId, {
      name: frame.name,
      visible: frame.visible,
      opacity: frame.opacity,
      blendMode: frame.blendMode,
      effects: frame.effects,
      isMask: frame.isMask,
      maskType: frame.maskType,
      ...box
    })
    graph.insertChildAt(group.id, parentId, index)
    for (const child of children) {
      graph.insertChildAt(child.id, group.id, Infinity)
      graph.updateNode(child.id, { x: child.x - box.x, y: child.y - box.y })
    }
    graph.deleteNode(id)
  }
  ctx.groups.clear()
}

/** What a set of layers shows, through the staged groups among them, in canvas pixels. */
function shownLayers(ctx: Context, nodes: readonly SceneNode[]): SceneNode[] {
  return nodes.flatMap((node) => {
    if (!node.visible) return []
    if (!ctx.groups.has(node.id)) return [node]
    return shownLayers(ctx, ctx.graph.getChildren(node.id))
  })
}

/** A vector mask on a layer other than a shape layer, whose vector mask is its shape. */
function maskingPaths(ctx: Context, layer: Layer) {
  const mask = layer.vectorMask
  if (!mask || mask.disable || mask.paths.length === 0) return null
  if (!layer.children && isEditableShapeLayer(layer, ctx.patternFill)) return null
  return mask.paths
}

/** Whether the layer draws through a mask, and so sits in a group with it. */
function isMasked(ctx: Context, layer: Layer): boolean {
  return activeRasterMask(layer.mask) || maskingPaths(ctx, layer) !== null
}

/** Groups `ids`, the layers one Photoshop layer made, under its masks, where the first was. */
function wrapInMasks(ctx: Context, parentId: string, layer: Layer, ids: string[]): string[] {
  const { graph } = ctx
  const nodes = ids.map((id) => graph.getNode(id)).filter((node) => node !== undefined)
  const shown = shownLayers(ctx, nodes)
  if (shown.length === 0) return ids
  const content = groupBounds(graph, shown, parentId, { x: 0, y: 0 })
  const name = layer.name ?? 'Layer'
  const wrapper = stageGroup(ctx, parentId, { name, visible: !layer.hidden })
  graph.insertChildAt(wrapper.id, parentId, expectNode(graph, parentId).childIds.indexOf(ids[0]))
  // Photoshop applies a layer's vector mask and its raster mask together: one masks the other's.
  let target = wrapper.id
  const paths = maskingPaths(ctx, layer)
  if (paths && addVectorMask(graph, target, paths, 'Vector mask', ctx.canvas)) {
    if (activeRasterMask(layer.mask)) target = stageGroup(ctx, target, { name }).id
  }
  if (activeRasterMask(layer.mask)) {
    addRasterMask(graph, target, layer.mask, content, (pixels) => imageFill(ctx, pixels))
  }
  for (const id of ids) graph.insertChildAt(id, target, Infinity)
  return [wrapper.id]
}

function expectNode(graph: SceneGraph, id: string): SceneNode {
  const node = graph.getNode(id)
  if (!node) throw new Error(`Missing layer ${id}`)
  return node
}

/** Adds one Photoshop layer, returning the layers it made in `parentId`, bottom first. */
function addLayer(ctx: Context, parentId: string, layer: Layer): string[] {
  const parent = expectNode(ctx.graph, parentId)
  const before = parent.childIds.length
  const masked = isMasked(ctx, layer)
  // A masked layer's visibility goes to the group that holds it with its masks.
  const shown = masked ? true : !layer.hidden
  addLayerContent(ctx, parentId, layer, shown)
  const ids = parent.childIds.slice(before)
  return masked && ids.length > 0 ? wrapInMasks(ctx, parentId, layer, ids) : ids
}

/**
 * Photoshop's clipping masks: the layers marked to clip draw only inside the pixels of the layer
 * below them. They go in a group with that base layer, above a mask of its pixels.
 */
function startClipping(
  ctx: Context,
  parentId: string,
  base: { layer: Layer; ids: string[] }
): string | null {
  const { graph } = ctx
  const pixels = base.layer.imageData
  const fill = pixels && pixels.width > 0 && pixels.height > 0 ? imageFill(ctx, pixels) : null
  if (!fill && base.ids.length !== 1) return null
  const parent = expectNode(graph, parentId)
  const index = parent.childIds.indexOf(base.ids[0])
  const group = stageGroup(ctx, parentId, {
    name: base.layer.name ?? 'Layer',
    visible: !base.layer.hidden
  })
  graph.insertChildAt(group.id, parentId, index)
  for (const id of base.ids) graph.insertChildAt(id, group.id, Infinity)
  const mask = { name: 'Clipping mask', isMask: true, maskType: 'ALPHA' } as const
  if (fill && pixels) {
    graph.createNode('RECTANGLE', group.id, {
      ...mask,
      ...bounds(base.layer),
      width: pixels.width,
      height: pixels.height,
      fills: [fill]
    })
  } else {
    // A group has no pixels of its own: its layers, copied, clip what is above it.
    cloneStaged(ctx, base.ids[0], group.id, { ...mask, visible: true })
  }
  return group.id
}

/** A copy of a layer and what it holds, whose staged groups are staged too. */
function cloneStaged(
  ctx: Context,
  sourceId: string,
  parentId: string,
  overrides: Partial<SceneNode>
): void {
  const clone = ctx.graph.cloneTree(sourceId, parentId, overrides)
  if (!clone) return
  const pair = (source: string, copy: string) => {
    if (ctx.groups.has(source)) ctx.groups.add(copy)
    const copies = expectNode(ctx.graph, copy).childIds
    expectNode(ctx.graph, source).childIds.forEach((child, index) => pair(child, copies[index]))
  }
  pair(sourceId, clone.id)
}

function addLayers(ctx: Context, parentId: string, layers: readonly Layer[]) {
  let base: { layer: Layer; ids: string[] } | null = null
  let clipping: string | null = null
  for (const layer of layers) {
    const ids = addLayer(ctx, parentId, layer)
    if (layer.clipping && base) {
      clipping ??= startClipping(ctx, parentId, base)
      if (clipping) for (const id of ids) ctx.graph.insertChildAt(id, clipping, Infinity)
      continue
    }
    base = ids.length > 0 ? { layer, ids } : null
    clipping = null
  }
}

function addLayerContent(ctx: Context, parentId: string, layer: Layer, shown: boolean) {
  const style = layerStyle(layer.effects, ctx.globalAngle, ctx.patternFill)
  if (layer.children) {
    const group = stageGroup(ctx, parentId, { ...common(layer, shown), effects: style.effects })
    addLayers(ctx, group.id, layer.children)
    return
  }
  const pixels = layer.imageData
  if (layer.text) {
    // The rendered text stays underneath, hidden, as the exact look if a font is missing.
    if (pixels) addPixels(ctx, parentId, layer, pixels, false)
    addText(ctx, parentId, layer, shown, style)
    return
  }
  if (isEditableShapeLayer(layer, ctx.patternFill)) {
    // So does a shape's, in case it cannot be redrawn exactly (a boolean of paths, say).
    if (pixels) addPixels(ctx, parentId, layer, pixels, false)
    const shape = addShapeLayer(
      ctx.graph,
      parentId,
      layer,
      { ...common(layer, shown), effects: style.effects },
      ctx.canvas,
      ctx.patternFill
    )
    if (shape) {
      ctx.graph.updateNode(shape.id, {
        fills: [...shape.fills, ...style.overlays],
        strokes: [...shape.strokes, ...style.strokes]
      })
      return
    }
  }
  if (!pixels) return
  const styled = style.overlays.length > 0 || style.strokes.length > 0
  if (styled && addStyledPixels(ctx, parentId, layer, pixels, shown, style)) return
  // Pixels cast shadows and glows from what they draw.
  addPixels(ctx, parentId, layer, pixels, shown, style.effects)
}

/**
 * A pixel layer whose style strokes or covers it: its pixels, and above them an outline vector
 * traced from what they draw, which carries the overlays as fills, the strokes as strokes and
 * the layer's effects, so all of them follow the drawn pixels rather than the layer's box.
 */
function addStyledPixels(
  ctx: Context,
  parentId: string,
  layer: Layer,
  pixels: ImageDataLike,
  shown: boolean,
  style: LayerStyle
): boolean {
  const rgba = toRGBA8(pixels.data)
  const d = pixelOutline(rgba, pixels.width, pixels.height)
  const network = d ? parseSVGPath(d, 'EVENODD') : null
  if (!network || network.segments.length === 0) return false
  const fill = imageFill(ctx, pixels)
  if (!fill) return false
  const box = bounds(layer)
  const size = { width: pixels.width, height: pixels.height }
  const group = ctx.graph.createNode('GROUP', parentId, {
    ...common(layer, shown),
    x: box.x,
    y: box.y,
    ...size
  })
  const name = layer.name ?? 'Layer'
  ctx.graph.createNode('RECTANGLE', group.id, { name, ...size, fills: [fill] })
  const outline = computeAccurateBounds(network)
  ctx.graph.createNode('VECTOR', group.id, {
    name: `${name} (style)`,
    x: outline.x,
    y: outline.y,
    width: Math.max(outline.width, 0.01),
    height: Math.max(outline.height, 0.01),
    vectorNetwork: transformVectorNetwork([1, 0, -outline.x, 0, 1, -outline.y, 0, 0, 1], network),
    fills: style.overlays,
    strokes: style.strokes,
    effects: style.effects
  })
  return true
}

function addPixels(
  ctx: Context,
  parentId: string,
  layer: Layer,
  pixels: ImageDataLike,
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
    x: box.x,
    y: box.y,
    width: pixels.width,
    height: pixels.height,
    fills: [fill],
    effects
  })
}

/** The patterns the document and its layers define, by id. */
function collectPatterns(psd: Psd): Map<string, PatternInfo> {
  const patterns = new Map<string, PatternInfo>()
  const visit = (layer: Layer) => {
    for (const pattern of layer.patterns ?? []) patterns.set(pattern.id, pattern)
    for (const child of layer.children ?? []) visit(child)
  }
  visit(psd)
  return patterns
}

/** Pattern overlays and fills as a tiled image of the pattern's pixels, each encoded once. */
function createPatternFill(ctx: Context, patterns: Map<string, PatternInfo>): PatternFill {
  const encoded = new Map<string, string | null>()
  return (pattern, scale, opacity) => {
    const info = pattern ? patterns.get(pattern.id) : undefined
    if (!info) return null
    let hash = encoded.get(info.id)
    if (hash === undefined) {
      const { w, h } = info.bounds
      const fill =
        w > 0 && h > 0 && info.data.length >= w * h * 4
          ? imageFill(ctx, { width: w, height: h, data: info.data })
          : null
      hash = fill?.imageHash ?? null
      encoded.set(info.id, hash)
    }
    if (!hash) return null
    return {
      type: 'IMAGE',
      imageHash: hash,
      imageScaleMode: 'TILE',
      scale: scale > 0 ? scale : 1,
      color: { ...BLACK },
      opacity,
      visible: true
    }
  }
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
    globalAngle: psd.imageResources?.globalAngle ?? 120,
    patternFill: () => null,
    groups: new Set()
  }
  ctx.patternFill = createPatternFill(ctx, collectPatterns(psd))
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
    addLayers(ctx, frame.id, psd.children)
    finishGroups(ctx)
  } else if (psd.imageData) {
    // A flattened file: the composite is the one layer.
    addPixels(ctx, frame.id, { name: 'Background' }, psd.imageData, true)
  }
  return graph
}
