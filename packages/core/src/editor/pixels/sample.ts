import type { CanvasKit } from 'canvaskit-wasm'

import type { SceneGraph, SceneNode } from '@lawha/scene-graph'
import Matrix, { type Mat3 } from '@lawha/scene-graph/matrix'

import type { SkiaRenderer } from '#core/canvas'
import { createSceneGeometry } from '#core/geometry'
import type { RGBAImage } from '#core/io/formats/raster'
import { prepareSelectionRenderGraph } from '#core/io/formats/raster/render'
import { extractExportGraph, findPageId } from '#core/io/subgraph'

/**
 * What the fill bucket, magic wand, and colour picker read: the layer drawn by itself, or
 * everything visible on the page where the layer is, as Affinity's "Current Layer" and "All
 * Layers" sources do.
 */
export type PixelSampleScope = 'layer' | 'all'

/** The matrix from canvas coordinates to `node`'s pixel grid, or null when it has no inverse. */
export function canvasToGridMatrix(
  graph: SceneGraph,
  node: SceneNode,
  grid: { width: number; height: number }
): Mat3 | null {
  const inverse = Matrix.invert(createSceneGeometry(graph).worldMatrix(node))
  if (!inverse) return null
  return Matrix.multiply(Matrix.scaled(grid.width / node.width, grid.height / node.height), inverse)
}

/**
 * Renders what the canvas shows over `node`'s pixel grid, through the renderer, so gradients,
 * image adjustments, blend modes, and effects are sampled as they are drawn: the layer alone with
 * its children for `layer`, or every layer on its page for `all`. Transparent where nothing
 * draws. Null when CanvasKit cannot make a surface or the layer has no page.
 */
export function renderLayerGrid(
  ck: CanvasKit,
  renderer: SkiaRenderer,
  graph: SceneGraph,
  node: SceneNode,
  grid: { width: number; height: number },
  scope: PixelSampleScope
): RGBAImage | null {
  const pageId = findPageId(graph, node.id)
  const toGrid = canvasToGridMatrix(graph, node, grid)
  if (!pageId || !toGrid) return null
  let renderGraph = graph
  let renderPage = pageId
  if (scope === 'layer') {
    const extracted = extractExportGraph(graph, { scope: 'selection', nodeIds: [node.id] })
    if (!extracted.pageId) return null
    prepareSelectionRenderGraph(graph, extracted.graph, extracted.pageId, [node.id])
    renderGraph = extracted.graph
    renderPage = extracted.pageId
  }
  const surface = ck.MakeSurface(grid.width, grid.height)
  if (!surface) return null
  try {
    const canvas = surface.getCanvas()
    canvas.clear(ck.TRANSPARENT)
    canvas.concat(toGrid)
    renderer.renderSceneToCanvas(canvas, renderGraph, renderPage)
    surface.flush()
    const pixels = canvas.readPixels(0, 0, {
      alphaType: ck.AlphaType.Unpremul,
      colorType: ck.ColorType.RGBA_8888,
      colorSpace: ck.ColorSpace.SRGB,
      width: grid.width,
      height: grid.height
    })
    if (!pixels) return null
    return { width: grid.width, height: grid.height, data: new Uint8Array(pixels) }
  } finally {
    surface.delete()
  }
}
