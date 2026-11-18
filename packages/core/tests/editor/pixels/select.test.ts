import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test'

import { createEditor } from '@lawha/core'
import { SkiaRenderer } from '@lawha/core/canvas'
import { createSceneGeometry } from '@lawha/core/geometry'
import { createCanvasKitRasterCodec, initCanvasKit } from '@lawha/core/io/formats/raster'

setDefaultTimeout(60_000)

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

/** A 100 × 100 layer, its left half red and right half blue. */
async function twoColourLayer() {
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
  const data = new Uint8Array(100 * 100 * 4)
  for (let i = 0; i < 100 * 100; i++) {
    data.set(i % 100 < 50 ? [255, 0, 0, 255] : [0, 0, 255, 255], i * 4)
  }
  const png = codec.encodePNG({ width: 100, height: 100, data })
  if (!png) throw new Error('Could not encode')
  const hash = 'a'.repeat(40)
  editor.graph.images.set(hash, png)
  const node = editor.graph.createNode('RECTANGLE', editor.state.currentPageId, {
    name: 'Photo',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
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
  editor.select([node.id])
  return { editor, codec, node }
}

describe('pixel selections on a layer', () => {
  test('a dragged rectangle selects and outlines on the layer', async () => {
    const { editor, node } = await twoColourLayer()
    expect(editor.pixelSelectBegin('rect', 10, 10)).toBe(true)
    editor.pixelSelectMove(40, 30)
    expect(editor.state.pixelOverlay?.marquee).toMatchObject({ to: { x: 40, y: 30 } })
    expect(editor.pixelSelectEnd()).toBe(true)
    expect(editor.hasPixelSelection()).toBe(true)
    expect(editor.state.pixelOverlay).toMatchObject({ nodeId: node.id, marquee: null })
    expect(editor.state.pixelOverlay?.outline?.length).toBe(16)
  })

  test('a click with the marquee deselects', async () => {
    const { editor } = await twoColourLayer()
    editor.pixelSelectAll()
    editor.pixelSelectBegin('rect', 10, 10)
    editor.pixelSelectEnd()
    expect(editor.hasPixelSelection()).toBe(false)
  })

  test('the brush keeps to the selection', async () => {
    const { editor, codec, node } = await twoColourLayer()
    editor.setTool('MAGIC_WAND')
    expect(editor.pixelMagicWandAt(10, 50)).toBe(true)
    editor.setTool('BRUSH')
    editor.setPixelTools({ size: 30, hardness: 1, color: { r: 0, g: 1, b: 0, a: 1 } })
    editor.pixelStrokeBegin('BRUSH', 50, 50)
    editor.pixelStrokeEnd()
    const paint = editor.graph.getNode(node.id)?.fills[1]
    const bytes = paint?.imageHash ? editor.graph.images.get(paint.imageHash) : undefined
    const image = bytes ? codec.decode(bytes) : null
    expect(image?.data[(50 * 100 + 45) * 4 + 3]).toBe(255)
    expect(image?.data[(50 * 100 + 55) * 4 + 3]).toBe(0)
  })

  test('a mask from the selection groups a mask layer under the layer, in one step', async () => {
    const { editor, codec, node } = await twoColourLayer()
    editor.pixelMagicWandAt(80, 50)
    editor.pixelInvertSelection()
    const groupId = editor.pixelMaskFromSelection({ feather: 4 })
    const group = groupId ? editor.graph.getNode(groupId) : undefined
    expect(group).toMatchObject({ type: 'GROUP', name: 'Photo' })
    const [maskId, layerId] = group?.childIds ?? []
    expect(layerId).toBe(node.id)
    const mask = editor.graph.getNode(maskId)
    expect(mask).toMatchObject({ isMask: true, maskType: 'ALPHA', width: 100, height: 100 })
    const fill = mask?.fills[0]
    const bytes = fill?.imageHash ? editor.graph.images.get(fill.imageHash) : undefined
    const image = bytes ? codec.decode(bytes) : null
    expect(image?.data[(50 * 100 + 10) * 4 + 3]).toBe(255)
    expect(image?.data[(50 * 100 + 90) * 4 + 3]).toBe(0)
    const edge = image?.data[(50 * 100 + 50) * 4 + 3] ?? 0
    expect(edge).toBeGreaterThan(0)
    expect(edge).toBeLessThan(255)
    expect(editor.hasPixelSelection()).toBe(false)

    editor.undo.undo()
    expect(editor.graph.getNode(node.id)?.parentId).toBe(editor.state.currentPageId)
    expect(editor.graph.getNode(maskId)).toBeUndefined()
  })

  test('a marquee on a rotated layer selects its exact turned shape', async () => {
    const { editor, codec, node } = await twoColourLayer()
    editor.graph.updateNode(node.id, { rotation: 45 })
    const turned = editor.graph.getNode(node.id)
    if (!turned) throw new Error('No layer')
    const centre = createSceneGeometry(editor.graph).toWorld(turned, { x: 50, y: 50 })
    editor.setTool('MARQUEE_RECT')
    editor.pixelSelectBegin('rect', centre.x - 20, centre.y - 20)
    editor.pixelSelectMove(centre.x + 20, centre.y + 20)
    expect(editor.pixelSelectEnd()).toBe(true)
    // Fill everything the selection lets through, then read where the paint went.
    editor.setPixelTools({ tolerance: 1, contiguous: false, color: { r: 0, g: 1, b: 0, a: 1 } })
    expect(editor.pixelFillAt(centre.x, centre.y)).toBe(true)
    const fill = editor.graph.getNode(node.id)?.fills.at(-1)
    const bytes = fill?.imageHash ? editor.graph.images.get(fill.imageHash) : undefined
    const paint = bytes ? codec.decode(bytes) : null
    if (!paint) throw new Error('Nothing painted')
    const alpha = (x: number, y: number) => paint.data[(y * paint.width + x) * 4 + 3]
    // The canvas square is a diamond on the layer: its centre and tips are in, the corners of the
    // box two mapped corners would give are out.
    expect(alpha(50, 50)).toBe(255)
    expect(alpha(50, 26)).toBe(255)
    expect(alpha(74, 50)).toBe(255)
    expect(alpha(33, 33)).toBe(0)
    expect(alpha(67, 67)).toBe(0)
    let covered = 0
    for (let i = 3; i < paint.data.length; i += 4) covered += paint.data[i] / 255
    // A 40 × 40 square of canvas covers 1600 of the layer's pixels, however it is turned.
    expect(Math.abs(covered - 1600)).toBeLessThan(40)
  })
})
