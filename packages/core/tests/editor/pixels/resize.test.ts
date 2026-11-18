import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test'

import { createEditor } from '@lawha/core'
import { SkiaRenderer } from '@lawha/core/canvas'
import { createCanvasKitRasterCodec, initCanvasKit } from '@lawha/core/io/formats/raster'
import type { SceneNode } from '@lawha/scene-graph'
import { LAWHA_PLUGIN_DATA, readPluginData } from '@lawha/scene-graph/plugin-data'

import { loadPixelSurface } from '#core/editor/pixels/layer'
import { renderLayerGrid } from '#core/editor/pixels/sample'
import { storeImage } from '#core/figma-api/images'
import { blankImage, resampleImage } from '#core/pixels/composite'

setDefaultTimeout(60_000)

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

/** An editor with a `width` × `height` layer showing a white photo of `photo` pixels. */
async function layer(width: number, height: number, photo = { width, height }) {
  const ck = await initCanvasKit()
  const surface = ck.MakeSurface(400, 400)
  if (!surface) throw new Error('Could not create CanvasKit surface')
  const renderer = new SkiaRenderer(ck, surface)
  const editor = createEditor()
  editor.setCanvasKit(ck, renderer)
  cleanups.push(() => {
    editor.dispose()
    renderer.destroy()
  })
  const codec = createCanvasKitRasterCodec(ck)
  const image = blankImage(photo.width, photo.height)
  image.data.fill(255)
  const png = codec.encodePNG(image)
  if (!png) throw new Error('Could not encode')
  const node = editor.graph.createNode('RECTANGLE', editor.state.currentPageId, {
    width,
    height,
    fills: [
      {
        type: 'IMAGE',
        imageHash: storeImage(editor.graph, png),
        imageScaleMode: 'STRETCH' as 'FILL',
        color: { r: 0, g: 0, b: 0, a: 0 },
        opacity: 1,
        visible: true
      }
    ]
  })
  editor.select([node.id])
  const paint = () => {
    const current = editor.graph.getNode(node.id)
    const marker = readPluginData(current?.pluginData, LAWHA_PLUGIN_DATA.paintLayer)
    const bytes = marker ? editor.graph.images.get(marker.hash) : undefined
    return { marker, image: bytes ? codec.decode(bytes) : null }
  }
  const current = (): SceneNode => {
    const found = editor.graph.getNode(node.id)
    if (!found) throw new Error('No layer')
    return found
  }
  return { ck, renderer, editor, codec, node, paint, current }
}

describe('resampling paint', () => {
  test('nearest enlarges a pixel into a whole block, smooth blends it', () => {
    const image = blankImage(2, 1)
    image.data.set([255, 0, 0, 255, 0, 0, 255, 255])
    const crisp = resampleImage(image, 4, 2, 'nearest')
    expect([...crisp.data.subarray(4, 8)]).toEqual([255, 0, 0, 255])
    expect([...crisp.data.subarray(8, 12)]).toEqual([0, 0, 255, 255])
    const smooth = resampleImage(image, 4, 2, 'smooth')
    expect(smooth.data[4]).toBeGreaterThan(0)
    expect(smooth.data[4]).toBeLessThan(255)
  })
})

describe('painted layers keep their pixel resolution when resized', () => {
  test('a resized layer is painted at the density it was painted at, pixel for pixel', async () => {
    const { editor, codec, paint, current } = await layer(100, 50)
    editor.setTool('BRUSH')
    editor.setPixelTools({ color: { r: 1, g: 0, b: 0, a: 1 }, size: 10, hardness: 1 })
    editor.pixelStrokeBegin('BRUSH', 30, 25)
    editor.pixelStrokeEnd()
    expect(paint().marker).toMatchObject({ density: 1, resample: 'nearest' })
    const before = paint().image
    if (!before) throw new Error('Nothing painted')

    editor.graph.updateNode(current().id, { width: 200, height: 100 })
    const surface = loadPixelSurface(editor.graph, codec, current())
    expect([surface?.width, surface?.height]).toEqual([200, 100])
    // Every painted pixel became a 2 × 2 block of exactly its own value.
    for (const [x, y] of [
      [26, 25],
      [30, 21],
      [33, 28]
    ]) {
      const value = before.data[(y * 100 + x) * 4 + 3]
      for (const [dx, dy] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1]
      ]) {
        expect(surface?.paint.data[((y * 2 + dy) * 200 + x * 2 + dx) * 4 + 3]).toBe(value)
      }
    }

    // The next stroke keeps the new grid.
    editor.pixelStrokeBegin('BRUSH', 150, 50)
    editor.pixelStrokeEnd()
    expect([paint().image?.width, paint().image?.height]).toEqual([200, 100])
  })

  test('the resample option blends the paint smoothly instead', async () => {
    const { editor, codec, current, paint } = await layer(100, 50)
    editor.setTool('BRUSH')
    editor.setPixelTools({ size: 10, hardness: 1 })
    editor.pixelStrokeBegin('BRUSH', 30, 25)
    editor.pixelStrokeEnd()
    const painted = new Set<number>()
    const before = paint().image
    for (let i = 3; i < (before?.data.length ?? 0); i += 4) painted.add(before?.data[i] ?? 0)
    expect(editor.pixelPaintResample()).toBe('nearest')
    expect(editor.setPixelPaintResample('smooth')).toBe(true)
    expect(editor.pixelPaintResample()).toBe('smooth')
    editor.graph.updateNode(current().id, { width: 300, height: 150 })
    const surface = loadPixelSurface(editor.graph, codec, current())
    const blended = new Set<number>()
    for (let i = 3; i < (surface?.paint.data.length ?? 0); i += 4) {
      const alpha = surface?.paint.data[i] ?? 0
      if (!painted.has(alpha)) blended.add(alpha)
    }
    // Bilinear: the edge takes in-between values no painted pixel had.
    expect(blended.size).toBeGreaterThan(5)
    editor.undo.undo()
    editor.select([current().id])
    expect(editor.pixelPaintResample()).toBe('nearest')
  })

  test('an enlarged paint layer draws as crisp blocks, not a blur', async () => {
    const { ck, renderer, editor, current } = await layer(20, 20)
    editor.setTool('BRUSH')
    editor.setPixelTools({ color: { r: 0, g: 0, b: 0, a: 1 }, size: 1, hardness: 1 })
    editor.pixelStrokeBegin('BRUSH', 10.5, 10.5)
    editor.pixelStrokeEnd()
    editor.graph.updateNode(current().id, { width: 200, height: 200 })
    const shown = renderLayerGrid(
      ck,
      renderer,
      editor.graph,
      current(),
      { width: 200, height: 200 },
      'layer'
    )
    if (!shown) throw new Error('Nothing rendered')
    const red = (x: number, y: number) => shown.data[(y * 200 + x) * 4]
    // The painted pixel covers canvas 100–110: dark through its block, white right outside it.
    expect(red(101, 105)).toBeLessThan(40)
    expect(red(108, 105)).toBeLessThan(40)
    expect(red(112, 105)).toBeGreaterThan(215)
    expect(red(97, 105)).toBeGreaterThan(215)
  })

  test('the brush cursor matches the layer pixels before anything is painted', async () => {
    // A 400 × 200 photo on a 100 × 50 layer: four pixels to the unit.
    const { editor } = await layer(100, 50, { width: 400, height: 200 })
    editor.setTool('BRUSH')
    editor.setPixelTools({ size: 24 })
    editor.pixelHover(50, 25)
    expect(editor.state.pixelOverlay?.brush?.radius).toBe(3)
    editor.clearSelection()
    editor.pixelHover(50, 25)
    expect(editor.state.pixelOverlay?.brush?.radius).toBe(3)
  })
})
