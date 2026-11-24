import type { LayerMaskData, PixelData } from 'ag-psd'

import type { Fill, SceneGraph, SceneNode } from '@lawha/scene-graph'
import type { Rect } from '@lawha/scene-graph/primitives'

/**
 * Photoshop's layer (raster) masks as luminance masks. A mask covers only its own box; beyond it
 * every pixel is its default colour, white showing the layer and black hiding it. So the mask
 * layer covers what it masks where the default shows it, and only the mask's box where it hides.
 */

/** Photoshop's grey for a mask pixel, lightened by the mask's density: 0 density shows all. */
function densityGrey(value: number, density: number): number {
  return Math.round(255 - density * (255 - value))
}

function intersect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.width, b.x + b.width)
  const bottom = Math.min(a.y + a.height, b.y + b.height)
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null
}

/** A rectangle grown out to whole pixels. */
function pixelRect(rect: Rect): Rect {
  const x = Math.floor(rect.x)
  const y = Math.floor(rect.y)
  return {
    x,
    y,
    width: Math.ceil(rect.x + rect.width) - x,
    height: Math.ceil(rect.y + rect.height) - y
  }
}

/** Whether the layer has a raster mask that applies. */
export function activeRasterMask(mask: LayerMaskData | undefined): mask is LayerMaskData {
  return !!mask && !mask.disabled && maskBox(mask) !== null
}

function maskBox(mask: LayerMaskData): Rect | null {
  const left = mask.left ?? 0
  const top = mask.top ?? 0
  const width = (mask.right ?? left) - left
  const height = (mask.bottom ?? top) - top
  return width > 0 && height > 0 && mask.imageData ? { x: left, y: top, width, height } : null
}

/**
 * The greys of `mask` over `area`, as opaque RGBA: the mask's own pixels inside its box, its
 * default colour outside.
 */
function maskPixels(mask: LayerMaskData, area: Rect): PixelData {
  const density = mask.userMaskDensity ?? 1
  const fallback = densityGrey(mask.defaultColor ?? 255, density)
  const data = new Uint8ClampedArray(area.width * area.height * 4)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = data[i + 1] = data[i + 2] = fallback
    data[i + 3] = 255
  }
  const box = maskBox(mask)
  const source = mask.imageData
  const overlap = box ? intersect(box, area) : null
  if (box && source && overlap) {
    for (let y = overlap.y; y < overlap.y + overlap.height; y++) {
      for (let x = overlap.x; x < overlap.x + overlap.width; x++) {
        const from = ((y - box.y) * source.width + (x - box.x)) * 4
        const to = ((y - area.y) * area.width + (x - area.x)) * 4
        // Masks are grey, so their red channel is their value at any depth ag-psd reads.
        const value = source.data[from] ?? fallback
        const grey = densityGrey(value > 255 ? value / 257 : value, density)
        data[to] = data[to + 1] = data[to + 2] = grey
      }
    }
  }
  return { width: area.width, height: area.height, data }
}

/**
 * A luminance mask layer for `mask` over content drawn in `content` (canvas pixels), or null when
 * nothing is left to draw a mask over. `encode` turns its greys into an image fill.
 */
export function addRasterMask(
  graph: SceneGraph,
  parentId: string,
  mask: LayerMaskData,
  content: Rect,
  encode: (pixels: PixelData) => Fill | null
): SceneNode | null {
  const box = maskBox(mask)
  // Where the default hides, nothing outside the mask's box shows, so the mask need not reach.
  const reach = mask.defaultColor === 0 ? (box ? intersect(box, content) : null) : content
  if (!reach) return null
  const area = pixelRect(reach)
  if (area.width <= 0 || area.height <= 0) return null
  const fill = encode(maskPixels(mask, area))
  if (!fill) return null
  return graph.createNode('RECTANGLE', parentId, {
    name: 'Layer mask',
    ...area,
    fills: [fill],
    isMask: true,
    maskType: 'LUMINANCE'
  })
}
