import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test'

import { createEditor } from '@lawha/core'
import { SkiaRenderer } from '@lawha/core/canvas'
import { createCanvasKitRasterCodec, initCanvasKit } from '@lawha/core/io/formats/raster'

setDefaultTimeout(60_000)

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

/** A 100 × 50 layer, red on the left half and blue on the right. */
async function photo() {
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
  for (let i = 0; i < 100 * 50; i++) {
    data.set(i % 100 < 50 ? [255, 0, 0, 255] : [0, 0, 255, 255], i * 4)
  }
  const png = codec.encodePNG({ width: 100, height: 50, data })
  if (!png) throw new Error('Could not encode')
  editor.graph.images.set('b'.repeat(40), png)
  const node = editor.graph.createNode('RECTANGLE', editor.state.currentPageId, {
    width: 100,
    height: 50,
    fills: [
      {
        type: 'IMAGE',
        imageHash: 'b'.repeat(40),
        imageScaleMode: 'FILL',
        color: { r: 0, g: 0, b: 0, a: 0 },
        opacity: 1,
        visible: true
      }
    ]
  })
  editor.select([node.id])
  const paint = () => {
    const fill = editor.graph.getNode(node.id)?.fills[1]
    const bytes = fill?.imageHash ? editor.graph.images.get(fill.imageHash) : undefined
    return bytes ? codec.decode(bytes) : null
  }
  return { editor, node, paint }
}

describe('clone stamp and healing brush', () => {
  test('needs a source before it paints', async () => {
    const { editor } = await photo()
    editor.setTool('CLONE_STAMP')
    expect(editor.pixelStrokeBegin('CLONE_STAMP', 75, 25)).toBe(false)
  })

  test('copies from the Alt-clicked source, keeping the offset for later strokes', async () => {
    const { editor, paint } = await photo()
    editor.setTool('CLONE_STAMP')
    editor.setPixelTools({ size: 10, hardness: 1 })
    expect(editor.pixelSetCloneSource(20, 25)).toBe(true)
    expect(editor.state.pixelOverlay?.cloneSource).toEqual({ x: 20, y: 25 })
    editor.pixelStrokeBegin('CLONE_STAMP', 75, 25)
    editor.pixelStrokeEnd()
    const first = paint()
    expect([...(first?.data.subarray((25 * 100 + 75) * 4, (25 * 100 + 75) * 4 + 4) ?? [])]).toEqual(
      [255, 0, 0, 255]
    )
    // Same offset: painting at x 90 copies from x 35, still red.
    editor.pixelStrokeBegin('CLONE_STAMP', 90, 10)
    editor.pixelStrokeEnd()
    expect(paint()?.data[(10 * 100 + 90) * 4]).toBe(255)
    editor.undo.undo()
    expect(paint()?.data[(10 * 100 + 90) * 4 + 3]).toBe(0)
  })

  test('the healing brush keeps the tone around where it paints', async () => {
    const { editor, paint } = await photo()
    editor.setTool('HEALING_BRUSH')
    editor.setPixelTools({ size: 8, hardness: 1 })
    editor.pixelSetCloneSource(20, 25)
    editor.pixelStrokeBegin('HEALING_BRUSH', 80, 25)
    editor.pixelStrokeEnd()
    const pixel = paint()?.data.subarray((25 * 100 + 80) * 4, (25 * 100 + 80) * 4 + 4)
    // Flat red copied into flat blue takes the blue: the colour shift cancels the source's tone.
    expect(pixel?.[2]).toBeGreaterThan(200)
    expect(pixel?.[0]).toBeLessThan(60)
  })
})
