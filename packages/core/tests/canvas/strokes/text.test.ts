import { describe, expect, setDefaultTimeout, test } from 'bun:test'

import { expectDefined } from '#core-tests/helpers/assert'

import { getCanvasKit } from '@lawha/core/canvaskit'
import { headlessRenderNodes } from '@lawha/core/io/formats/raster'
import { SceneGraph, type SceneNode, type Stroke } from '@lawha/scene-graph'

setDefaultTimeout(60_000)

const GREY = { r: 0.5, g: 0.5, b: 0.5, a: 1 }
const WHITE_STROKE: Stroke = {
  type: 'SOLID',
  color: { r: 1, g: 1, b: 1, a: 1 },
  opacity: 1,
  visible: true,
  weight: 4,
  align: 'OUTSIDE'
}

/** Points 2 px outside the text's box: its corners and the middles of its left and bottom edges. */
const BOX_EDGE = [
  [8, 8],
  [292, 8],
  [8, 60],
  [150, 112],
  [292, 112]
]

/** Renders stroked text on grey and returns how many pixels its white stroke covers, and where. */
async function renderStroked(text: Partial<SceneNode>) {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  const frame = graph.createNode('FRAME', page.id, {
    width: 300,
    height: 120,
    fills: [{ type: 'SOLID', color: GREY, opacity: 1, visible: true }]
  })
  graph.createNode('TEXT', frame.id, {
    x: 10,
    y: 10,
    width: 280,
    height: 100,
    fontSize: 48,
    textAutoResize: 'NONE',
    fills: [{ type: 'SOLID', color: { r: 0.4, g: 0, b: 0.2, a: 1 }, opacity: 1, visible: true }],
    strokes: [WHITE_STROKE],
    ...text
  })
  const png = expectDefined(await headlessRenderNodes(graph, page.id, [frame.id]))
  const ck = await getCanvasKit()
  const image = expectDefined(ck.MakeImageFromEncoded(png))
  const width = image.width()
  const pixels = expectDefined(
    image.readPixels(0, 0, {
      width,
      height: image.height(),
      colorType: ck.ColorType.RGBA_8888,
      alphaType: ck.AlphaType.Unpremul,
      colorSpace: ck.ColorSpace.SRGB
    })
  )
  image.delete()
  const white = (x: number, y: number) => pixels[(y * width + x) * 4] > 240
  let count = 0
  for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 240) count++
  return { count, white }
}

describe('stroked text', () => {
  test('is stroked along its glyphs, not around its box', async () => {
    const { count, white } = await renderStroked({ text: 'Stroke', fontFamily: 'Inter' })
    expect(count).toBeGreaterThan(500)
    // Just outside the box, where a stroke around it would be, nothing is stroked.
    for (const [x, y] of BOX_EDGE) expect(white(x, y)).toBe(false)
  })

  test('Arabic text, which has no outlines to stroke, is stroked along its laid-out glyphs', async () => {
    const { count, white } = await renderStroked({
      text: 'السَّلَامُ عليكم',
      fontFamily: 'Noto Naskh Arabic',
      textDirection: 'RTL',
      textAlignHorizontal: 'RIGHT'
    })
    expect(count).toBeGreaterThan(500)
    for (const [x, y] of BOX_EDGE) expect(white(x, y)).toBe(false)
  })
})
