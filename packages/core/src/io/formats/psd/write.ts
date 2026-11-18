import { writePsdUint8Array, type Layer } from 'ag-psd'
import type { CanvasKit } from 'canvaskit-wasm'

import type { SceneGraph } from '@lawha/scene-graph'

import { getCanvasKit } from '#core/canvaskit'
import { createCanvasKitRasterCodec } from '#core/io/formats/raster'

import { preparePSDRuntime } from './runtime'

/** Renders layers to PNG at 1x; null when nothing draws. */
export type PSDRasterizer = (nodeIds: string[]) => Promise<Uint8Array | null>

export interface PSDWriteInput {
  graph: SceneGraph
  /** The frame, or other layer, that becomes the Photoshop canvas. */
  rootId: string
  rasterize: PSDRasterizer
  canvasKit?: CanvasKit
}

/**
 * A layered `.psd`: the root is the canvas and each of its direct children one Photoshop layer,
 * rendered at its place with its name, visibility and opacity, plus the flattened composite so
 * any viewer shows the whole design. Text and vectors arrive as pixels, as in Figma's PSD export.
 */
export async function writePSDDocument(input: PSDWriteInput): Promise<Uint8Array> {
  preparePSDRuntime()
  const { graph, rootId } = input
  const root = graph.getNode(rootId)
  if (!root) throw new Error('Nothing to export')
  const ck = input.canvasKit ?? (await getCanvasKit())
  const codec = createCanvasKitRasterCodec(ck)
  const width = Math.max(1, Math.round(root.width))
  const height = Math.max(1, Math.round(root.height))
  const origin = graph.getAbsoluteBounds(rootId)

  const decode = (png: Uint8Array | null) => (png ? codec.decode(png) : null)
  const composite = decode(await input.rasterize([rootId]))

  const layers: Layer[] = []
  for (const id of root.childIds) {
    const node = graph.getNode(id)
    if (!node) continue
    // Opacity and visibility belong to the Photoshop layer, so render the layer at full opacity.
    const restore = { opacity: node.opacity, visible: node.visible }
    graph.updateNode(id, { opacity: 1, visible: true })
    let pixels: ReturnType<typeof decode> = null
    try {
      pixels = decode(await input.rasterize([id]))
    } finally {
      graph.updateNode(id, restore)
    }
    if (!pixels) continue
    const box = graph.getAbsoluteBounds(id)
    // A render covers effects drawn outside the box (shadows), centred on it.
    const left = Math.round(box.x - origin.x - (pixels.width - box.width) / 2)
    const top = Math.round(box.y - origin.y - (pixels.height - box.height) / 2)
    layers.push({
      name: node.name,
      left,
      top,
      right: left + pixels.width,
      bottom: top + pixels.height,
      hidden: !node.visible,
      opacity: node.opacity,
      imageData: {
        width: pixels.width,
        height: pixels.height,
        data: new Uint8ClampedArray(pixels.data)
      }
    })
  }

  return writePsdUint8Array(
    {
      width,
      height,
      children: layers,
      ...(composite
        ? {
            imageData: {
              width: composite.width,
              height: composite.height,
              data: new Uint8ClampedArray(composite.data)
            }
          }
        : {})
    },
    { generateThumbnail: false, noBackground: true }
  )
}
