import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test'

import { createEditor } from '@lawha/core'
import { SkiaRenderer } from '@lawha/core/canvas'
import { createSceneGeometry } from '@lawha/core/geometry'
import { createCanvasKitRasterCodec, initCanvasKit } from '@lawha/core/io/formats/raster'
import type { Fill, SceneNode } from '@lawha/scene-graph'
import { LAWHA_PLUGIN_DATA, readPluginData } from '@lawha/scene-graph/plugin-data'

setDefaultTimeout(60_000)

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

/** Black on the left to white on the right, across the layer. */
const GRADIENT: Fill = {
  type: 'GRADIENT_LINEAR',
  color: { r: 0, g: 0, b: 0, a: 1 },
  opacity: 1,
  visible: true,
  gradientStops: [
    { position: 0, color: { r: 0, g: 0, b: 0, a: 1 } },
    { position: 1, color: { r: 1, g: 1, b: 1, a: 1 } }
  ],
  gradientTransform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 }
}

async function setup() {
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
  const layer = editor.graph.createNode('RECTANGLE', editor.state.currentPageId, {
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    fills: [GRADIENT]
  })
  editor.select([layer.id])
  const paint = (node: SceneNode) => {
    const marker = readPluginData(
      editor.graph.getNode(node.id)?.pluginData,
      LAWHA_PLUGIN_DATA.paintLayer
    )
    const bytes = marker ? editor.graph.images.get(marker.hash) : undefined
    return bytes ? codec.decode(bytes) : null
  }
  return { editor, layer, paint, codec }
}

describe('pixel tools sample the rendered layer', () => {
  test('the colour picker reads a gradient as it is drawn', async () => {
    const { editor } = await setup()
    const left = editor.pixelPickColorAt(5, 25)
    const right = editor.pixelPickColorAt(95, 25)
    expect(left?.r).toBeLessThan(0.15)
    expect(right?.r).toBeGreaterThan(0.85)
  })

  test('the fill bucket stops where the gradient leaves the tolerance', async () => {
    const { editor, layer, paint } = await setup()
    editor.setPixelTools({ color: { r: 1, g: 0, b: 0, a: 1 }, tolerance: 0.2 })
    expect(editor.pixelFillAt(2, 25)).toBe(true)
    const painted = paint(layer)
    if (!painted) throw new Error('Nothing painted')
    const at = (x: number) => painted.data[(25 * painted.width + x) * 4 + 3]
    expect(at(2)).toBe(255)
    expect(at(90)).toBe(0)
  })

  test('the magic wand and picker see image adjustments as drawn', async () => {
    const { editor, layer, codec } = await setup()
    // A dark grey photo, inverted by its adjustments: the tools must see it light.
    const data = new Uint8Array(100 * 50 * 4)
    for (let o = 0; o < data.length; o += 4) data.set([40, 40, 40, 255], o)
    const png = codec.encodePNG({ width: 100, height: 50, data })
    if (!png) throw new Error('Could not encode')
    editor.graph.images.set('c'.repeat(40), png)
    editor.graph.updateNode(layer.id, {
      fills: [
        {
          type: 'IMAGE',
          imageHash: 'c'.repeat(40),
          imageScaleMode: 'FILL',
          color: { r: 0, g: 0, b: 0, a: 0 },
          opacity: 1,
          visible: true,
          adjustments: { invert: true }
        }
      ]
    })
    expect(editor.pixelPickColorAt(50, 25)?.r).toBeCloseTo(215 / 255, 1)
    expect(editor.pixelMagicWandAt(50, 25)).toBe(true)
  })

  test('all layers samples what lies over the layer too', async () => {
    const { editor, layer } = await setup()
    editor.graph.createNode('RECTANGLE', editor.state.currentPageId, {
      x: 40,
      y: 0,
      width: 20,
      height: 50,
      fills: [{ type: 'SOLID', color: { r: 0, g: 1, b: 0, a: 1 }, opacity: 1, visible: true }]
    })
    editor.select([layer.id])
    const own = editor.pixelPickColorAt(50, 25)
    expect(own?.g).toBeLessThan(0.7)
    expect(own?.r).toBeGreaterThan(0.3)
    editor.setPixelTools({ sampleScope: 'all' })
    editor.select([layer.id])
    expect(editor.pixelPickColorAt(50, 25)).toEqual({ r: 0, g: 1, b: 0, a: 1 })
  })

  test('a rotated layer is sampled through its transform', async () => {
    const { editor, layer } = await setup()
    // Turned half way round, the layer's dark end lies on the right of the canvas.
    editor.graph.updateNode(layer.id, { rotation: 180, x: 100, y: 50 })
    const geometry = createSceneGeometry(editor.graph)
    const node = editor.graph.getNode(layer.id)
    if (!node) throw new Error('No layer')
    const dark = geometry.toWorld(node, { x: 5, y: 25 })
    const light = geometry.toWorld(node, { x: 95, y: 25 })
    expect(editor.pixelPickColorAt(dark.x, dark.y)?.r).toBeLessThan(0.15)
    expect(editor.pixelPickColorAt(light.x, light.y)?.r).toBeGreaterThan(0.85)
  })
})
