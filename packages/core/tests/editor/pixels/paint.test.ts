import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test'

import { createEditor } from '@lawha/core'
import { SkiaRenderer } from '@lawha/core/canvas'
import { createCanvasKitRasterCodec, initCanvasKit } from '@lawha/core/io/formats/raster'
import type { SceneNode } from '@lawha/scene-graph'
import { LAWHA_PLUGIN_DATA, readPluginData } from '@lawha/scene-graph/plugin-data'

import { storeImage } from '#core/figma-api/images'

setDefaultTimeout(60_000)

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

/** An editor with a renderer and a 100 × 50 layer showing a blue 100 × 50 photo. */
async function photoLayer() {
  const ck = await initCanvasKit()
  const surface = ck.MakeSurface(200, 200)
  if (!surface) throw new Error('Could not create CanvasKit surface')
  const renderer = new SkiaRenderer(ck, surface)
  const editor = createEditor()
  editor.setCanvasKit(ck, renderer)
  cleanups.push(() => {
    editor.dispose()
    renderer.destroy()
  })
  const codec = createCanvasKitRasterCodec(ck)
  const data = new Uint8Array(100 * 50 * 4)
  for (let o = 0; o < data.length; o += 4) data.set([0, 0, 255, 255], o)
  const png = codec.encodePNG({ width: 100, height: 50, data })
  if (!png) throw new Error('Could not encode')
  const hash = storeImage(editor.graph, png)
  const node = editor.graph.createNode('RECTANGLE', editor.state.currentPageId, {
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    fills: [
      {
        type: 'IMAGE',
        imageHash: hash,
        imageScaleMode: 'FILL',
        color: { r: 0, g: 0, b: 0, a: 0 },
        opacity: 1,
        visible: true
      }
    ]
  })
  return { editor, renderer, codec, node, photoHash: hash }
}

function paintPixels(
  editor: ReturnType<typeof createEditor>,
  codec: ReturnType<typeof createCanvasKitRasterCodec>,
  node: SceneNode
) {
  const current = editor.graph.getNode(node.id)
  const marker = readPluginData(current?.pluginData, LAWHA_PLUGIN_DATA.paintLayer)
  const bytes = marker ? editor.graph.images.get(marker.hash) : undefined
  return bytes ? codec.decode(bytes) : null
}

function alpha(image: { width: number; data: Uint8Array } | null, x: number, y: number) {
  return image ? image.data[(y * image.width + x) * 4 + 3] : -1
}

describe('pixel painting', () => {
  test('a brush stroke paints into a paint layer on top and keeps the photo', async () => {
    const { editor, codec, node, photoHash } = await photoLayer()
    editor.setTool('BRUSH')
    editor.setPixelTools({ color: { r: 1, g: 0, b: 0, a: 1 }, size: 10, hardness: 1 })

    expect(editor.pixelStrokeBegin('BRUSH', 10, 25)).toBe(true)
    editor.pixelStrokeMove(60, 25)
    expect(editor.pixelStrokeEnd()).toBe(true)

    const painted = editor.graph.getNode(node.id)
    expect(painted?.fills).toHaveLength(2)
    expect(painted?.fills[0].imageHash).toBe(photoHash)
    expect(painted?.fills[1]).toMatchObject({ type: 'IMAGE', imageScaleMode: 'CROP' })
    const paint = paintPixels(editor, codec, node)
    expect([paint?.width, paint?.height]).toEqual([100, 50])
    expect(alpha(paint, 30, 25)).toBe(255)
    expect(alpha(paint, 30, 5)).toBe(0)
    expect(paint?.data[(25 * 100 + 30) * 4]).toBe(255)

    editor.undo.undo()
    expect(editor.graph.getNode(node.id)?.fills).toHaveLength(1)
    editor.undo.redo()
    expect(editor.graph.getNode(node.id)?.fills).toHaveLength(2)
  })

  test('later strokes and the eraser reuse the same paint layer', async () => {
    const { editor, codec, node } = await photoLayer()
    editor.setTool('BRUSH')
    editor.setPixelTools({ size: 20, hardness: 1 })
    editor.pixelStrokeBegin('BRUSH', 50, 25)
    editor.pixelStrokeEnd()
    editor.setTool('ERASER')
    editor.pixelStrokeBegin('ERASER', 50, 25)
    editor.pixelStrokeEnd()

    expect(editor.graph.getNode(node.id)?.fills).toHaveLength(2)
    expect(alpha(paintPixels(editor, codec, node), 50, 25)).toBe(0)
  })

  test('a cancelled stroke leaves the layer as it was', async () => {
    const { editor, node } = await photoLayer()
    editor.setTool('BRUSH')
    editor.pixelStrokeBegin('BRUSH', 50, 25)
    editor.pixelStrokeCancel()
    expect(editor.graph.getNode(node.id)?.fills).toHaveLength(1)
    expect(editor.undo.canUndo).toBe(false)
  })

  test('the stroke shows on the canvas before it is committed', async () => {
    const { editor, renderer } = await photoLayer()
    editor.setTool('BRUSH')
    editor.pixelStrokeBegin('BRUSH', 50, 25)
    expect(renderer.images.live.size).toBe(1)
    editor.pixelStrokeEnd()
    expect(renderer.images.live.size).toBe(0)
  })

  test('the fill bucket fills like pixels as the layer shows them', async () => {
    const { editor, codec, node } = await photoLayer()
    editor.setPixelTools({ color: { r: 0, g: 1, b: 0, a: 1 }, tolerance: 0.1 })
    expect(editor.pixelFillAt(5, 5)).toBe(true)
    const paint = paintPixels(editor, codec, node)
    expect(alpha(paint, 99, 49)).toBe(255)
    expect(paint?.data[1]).toBe(255)
  })

  test('the colour picker sets the brush colour from what the layer shows', async () => {
    const { editor } = await photoLayer()
    expect(editor.pixelPickColorAt(20, 20)).toEqual({ r: 0, g: 0, b: 1, a: 1 })
    expect(editor.state.pixelTools.color).toEqual({ r: 0, g: 0, b: 1, a: 1 })
  })

  test('nothing is painted where no layer is', async () => {
    const { editor } = await photoLayer()
    editor.clearSelection()
    expect(editor.pixelStrokeBegin('BRUSH', 150, 150)).toBe(false)
  })
})
