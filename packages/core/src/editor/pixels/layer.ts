import type { Fill, NodeType, SceneGraph, SceneNode } from '@lawha/scene-graph'
import { IDENTITY_GRADIENT_TRANSFORM } from '@lawha/scene-graph/gradient'
import { LAWHA_PLUGIN_DATA, readPluginData, withPluginData } from '@lawha/scene-graph/plugin-data'
import type { Vector } from '@lawha/scene-graph/primitives'

import { TRANSPARENT } from '#core/constants'
import { createSceneGeometry } from '#core/geometry'
import type { RasterCodec, RGBAImage } from '#core/io/formats/raster'
import { blankImage, compositeOver, placeImage, type ImagePlacement } from '#core/pixels/composite'

/** Layers the pixel tools paint on: shapes and frames, whose fills can hold a paint layer. */
const PAINTABLE_TYPES: ReadonlySet<NodeType> = new Set<NodeType>([
  'RECTANGLE',
  'ELLIPSE',
  'FRAME',
  'POLYGON',
  'STAR',
  'VECTOR',
  'COMPONENT'
])

/** The longest edge a paint layer gets, as Figma limits images. */
export const PAINT_MAX_EDGE = 4096
/** The finest a paint layer goes over a large photo: four pixels to the layer's unit. */
const PAINT_MAX_DENSITY = 4

export function isPaintable(node: SceneNode | undefined): node is SceneNode {
  return !!node && PAINTABLE_TYPES.has(node.type) && node.width >= 1 && node.height >= 1
}

/** The index of the fill holding the layer's paint, or -1 when nothing was painted on it yet. */
export function paintFillIndex(node: SceneNode): number {
  const marker = readPluginData(node.pluginData, LAWHA_PLUGIN_DATA.paintLayer)
  if (!marker) return -1
  return node.fills.findIndex((fill) => fill.type === 'IMAGE' && fill.imageHash === marker.hash)
}

/**
 * A layer's pixels as the pixel tools work on them: what its fills under the paint show (`base`),
 * and the paint layer itself, both on one grid that spans the layer's bounds.
 */
export interface PixelSurface {
  nodeId: string
  width: number
  height: number
  base: RGBAImage
  paint: RGBAImage
  /** The fill the paint goes back into; -1 adds one on top. */
  paintIndex: number
}

function placementOf(fill: Fill): ImagePlacement {
  if (fill.imageScaleMode === 'FIT') return 'FIT'
  if (fill.imageScaleMode === 'CROP' || fill.imageScaleMode === 'TILE') return 'STRETCH'
  return 'FILL'
}

/** The grid a new paint layer gets: as fine as the photo under it, within the limits. */
function gridSize(node: SceneNode, photo: RGBAImage | null) {
  const density = photo
    ? Math.min(PAINT_MAX_DENSITY, Math.max(1, photo.width / node.width, photo.height / node.height))
    : 1
  let width = Math.max(1, Math.round(node.width * density))
  let height = Math.max(1, Math.round(node.height * density))
  const over = Math.max(width, height) / PAINT_MAX_EDGE
  if (over > 1) {
    width = Math.max(1, Math.round(width / over))
    height = Math.max(1, Math.round(height / over))
  }
  return { width, height }
}

function solidImage(width: number, height: number, fill: Fill): RGBAImage {
  const image = blankImage(width, height)
  const alpha = Math.round(fill.color.a * fill.opacity * 255)
  const pixel = [
    Math.round(fill.color.r * 255),
    Math.round(fill.color.g * 255),
    Math.round(fill.color.b * 255),
    alpha
  ]
  for (let o = 0; o < image.data.length; o += 4) image.data.set(pixel, o)
  return image
}

function decodeImageFills(graph: SceneGraph, codec: RasterCodec, fills: readonly Fill[]) {
  const decoded = new Map<Fill, RGBAImage>()
  for (const fill of fills) {
    if (fill.type !== 'IMAGE' || !fill.visible || !fill.imageHash) continue
    const bytes = graph.images.get(fill.imageHash)
    const image = bytes ? codec.decode(bytes) : null
    if (image) decoded.set(fill, image)
  }
  return decoded
}

/** What `fills` show together on the grid: solids and decoded images, in order. */
function composeFills(
  fills: readonly Fill[],
  decoded: ReadonlyMap<Fill, RGBAImage>,
  width: number,
  height: number
): RGBAImage {
  let base = blankImage(width, height)
  for (const fill of fills) {
    if (!fill.visible || fill.opacity <= 0) continue
    if (fill.type === 'SOLID') base = compositeOver(base, solidImage(width, height, fill))
    const image = decoded.get(fill)
    if (!image) continue
    const placed = placeImage(image, width, height, placementOf(fill))
    if (fill.opacity < 1) {
      for (let o = 3; o < placed.data.length; o += 4) {
        placed.data[o] = Math.round(placed.data[o] * fill.opacity)
      }
    }
    base = compositeOver(base, placed)
  }
  return base
}

/**
 * Reads the layer's pixels for painting. Solid and image fills under the paint layer make the
 * base the fill bucket, magic wand, and colour picker read; gradients and other paints are left
 * out of it.
 */
export function loadPixelSurface(
  graph: SceneGraph,
  codec: RasterCodec,
  node: SceneNode
): PixelSurface | null {
  if (!isPaintable(node)) return null
  const paintIndex = paintFillIndex(node)
  const paintHash = paintIndex >= 0 ? node.fills[paintIndex].imageHash : undefined
  const paintBytes = paintHash ? graph.images.get(paintHash) : undefined
  const painted = paintBytes ? codec.decode(paintBytes) : null
  const under = paintIndex >= 0 ? node.fills.slice(0, paintIndex) : node.fills
  const decoded = decodeImageFills(graph, codec, under)
  const { width, height } = painted ?? gridSize(node, [...decoded.values()].at(-1) ?? null)
  return {
    nodeId: node.id,
    width,
    height,
    base: composeFills(under, decoded, width, height),
    paint: painted ?? blankImage(width, height),
    paintIndex
  }
}

/** The layer's fills and plugin data with the paint layer's image set to `hash`. */
export function paintedLayerChanges(
  node: Pick<SceneNode, 'fills' | 'pluginData'>,
  paintIndex: number,
  hash: string
): Pick<SceneNode, 'fills' | 'pluginData'> {
  const paint: Fill = {
    type: 'IMAGE',
    imageHash: hash,
    // A crop of the whole image stretches it over the layer, as the grid maps onto it.
    imageScaleMode: 'CROP',
    imageTransform: { ...IDENTITY_GRADIENT_TRANSFORM },
    color: { ...TRANSPARENT },
    opacity: 1,
    visible: true
  }
  const fills =
    paintIndex >= 0
      ? node.fills.map((fill, index) =>
          index === paintIndex ? { ...fill, imageHash: hash } : fill
        )
      : [...node.fills, paint]
  return {
    fills,
    pluginData: withPluginData(node.pluginData, LAWHA_PLUGIN_DATA.paintLayer, { hash })
  }
}

/** A canvas point in the layer's pixel grid, or null when the layer cannot be inverted. */
export function canvasToGrid(
  graph: SceneGraph,
  node: SceneNode,
  surface: { width: number; height: number },
  point: Vector
): Vector | null {
  const local = createSceneGeometry(graph).toLocal(node, point)
  if (!local) return null
  return {
    x: (local.x / node.width) * surface.width,
    y: (local.y / node.height) * surface.height
  }
}

/** How many grid pixels one canvas unit spans on the layer, for sizing the brush cursor. */
export function gridScale(node: SceneNode, surface: { width: number }): number {
  return surface.width / node.width
}
