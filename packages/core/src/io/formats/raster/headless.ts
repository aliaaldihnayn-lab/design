import type { CanvasKit } from 'canvaskit-wasm'

import type { SceneGraph } from '@lawha/scene-graph'

import { SkiaRenderer } from '#core/canvas'
import type { PixelSampleScope } from '#core/editor/pixels/sample'
import { renderLayerGrid } from '#core/editor/pixels/sample'
import { findPageId } from '#core/io/subgraph'

import type { RGBAImage } from './pixels'
import { renderNodesToImage, renderThumbnail, type ExportFormat } from './render'

let cachedCk: CanvasKit | null = null
let cachedRenderer: SkiaRenderer | null = null

export async function initCanvasKit(): Promise<CanvasKit> {
  if (cachedCk) return cachedCk
  const CanvasKitInit = (await import('canvaskit-wasm/full')).default
  const ckURL = import.meta.resolve('canvaskit-wasm/full')
  cachedCk = await CanvasKitInit({
    locateFile: (file: string) => new URL(file, ckURL).href
  })
  return cachedCk
}

async function getRenderer(): Promise<{ ck: CanvasKit; renderer: SkiaRenderer }> {
  const ck = await initCanvasKit()
  if (cachedRenderer) return { ck, renderer: cachedRenderer }
  const surface = ck.MakeSurface(1, 1)
  if (!surface) throw new Error('Failed to create CanvasKit surface')
  const renderer = new SkiaRenderer(ck, surface)
  renderer.viewportWidth = 1
  renderer.viewportHeight = 1
  renderer.dpr = 1
  await renderer.loadFonts()
  cachedRenderer = renderer
  return { ck, renderer }
}

export async function headlessRenderNodes(
  graph: SceneGraph,
  pageId: string,
  nodeIds: string[],
  options: {
    scale?: number
    format?: ExportFormat
    quality?: number
    trimTransparent?: boolean
  } = {}
): Promise<Uint8Array | null> {
  const { ck, renderer } = await getRenderer()
  // One renderer serves every document: paths keyed by layer id must not outlive theirs.
  renderer.nodePaths.clear()
  renderer.invalidateAllPictures()
  await renderer.prepareForExport(graph, pageId, nodeIds)
  return renderNodesToImage(ck, renderer, graph, pageId, nodeIds, {
    scale: options.scale ?? 1,
    format: options.format ?? 'PNG',
    quality: options.quality,
    trimTransparent: options.trimTransparent
  })
}

export async function headlessRenderThumbnail(
  graph: SceneGraph,
  pageId: string,
  width: number,
  height: number
): Promise<Uint8Array | null> {
  const { ck, renderer } = await getRenderer()
  // One renderer serves every document: paths keyed by layer id must not outlive theirs.
  renderer.nodePaths.clear()
  renderer.invalidateAllPictures()
  await renderer.prepareForExport(graph, pageId, graph.getNode(pageId)?.childIds ?? [])
  return renderThumbnail(ck, renderer, graph, pageId, width, height)
}

/**
 * What the canvas draws over a layer's pixel grid, rendered headlessly: the layer alone or every
 * layer on its page, as the fill bucket and colour picker tools sample it. Null without the layer.
 */
export async function headlessRenderLayerGrid(
  graph: SceneGraph,
  nodeId: string,
  grid: { width: number; height: number },
  scope: PixelSampleScope
): Promise<RGBAImage | null> {
  const node = graph.getNode(nodeId)
  if (!node) return null
  const { ck, renderer } = await getRenderer()
  renderer.nodePaths.clear()
  renderer.invalidateAllPictures()
  const pageId = findPageId(graph, nodeId)
  if (!pageId) return null
  await renderer.prepareForExport(graph, pageId, graph.getNode(pageId)?.childIds ?? [])
  return renderLayerGrid(ck, renderer, graph, node, grid, scope)
}
