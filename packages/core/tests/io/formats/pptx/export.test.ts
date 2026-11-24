import { describe, expect, setDefaultTimeout, test } from 'bun:test'

import { expectDefined } from '#core-tests/helpers/assert'
import { unzipSync } from 'fflate'

import { getCanvasKit } from '@lawha/core/canvaskit'
import { BUILTIN_IO_FORMATS, IORegistry } from '@lawha/core/io'
import { SceneGraph } from '@lawha/scene-graph'
import { parseSVGPath } from '@lawha/scene-graph/parse-path'

setDefaultTimeout(60_000)

const io = new IORegistry(BUILTIN_IO_FORMATS)

describe('PPTX round trips', () => {
  test('a turned or reflected vector is pictured upright and turned on the slide', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0].id
    const slide = graph.createNode('FRAME', page, { name: 'Slide', width: 1280, height: 720 })
    const arrow = 'M0 25L150 25L150 0L200 50L150 100L150 75L0 75Z'
    for (const [index, turn] of [{ rotation: 30 }, { rotation: -30, flipX: true }].entries()) {
      graph.createNode('VECTOR', slide.id, {
        name: `Arrow ${index}`,
        x: 100 + index * 400,
        y: 200,
        width: 200,
        height: 100,
        vectorNetwork: parseSVGPath(arrow, 'NONZERO'),
        fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 }, opacity: 1, visible: true }],
        ...turn
      })
    }
    const result = await io.exportContent('pptx', {
      graph,
      target: { scope: 'node', nodeId: slide.id }
    })
    if (typeof result.data === 'string') throw new Error('PPTX is binary')
    const files = unzipSync(new Uint8Array(result.data))
    const ck = await getCanvasKit()
    const pictures = Object.entries(files).filter(([name]) => name.endsWith('.png'))
    expect(pictures).toHaveLength(2)
    for (const [, png] of pictures) {
      const image = expectDefined(ck.MakeImageFromEncoded(png))
      // The arrow as drawn upright, twice as wide as tall, not its turned bounding box.
      expect(image.width() / image.height()).toBeCloseTo(2, 1)
      image.delete()
    }
    const again = (await io.readDocument({ name: 'deck.pptx', data: new Uint8Array(result.data) }))
      .graph
    const pictured = again
      .getChildren(again.getChildren(again.getPages()[0].id)[0].id)
      .filter((node) => node.fills.some((fill) => fill.type === 'IMAGE'))
    expect(pictured.map((node) => [node.x, node.y, node.width, node.height])).toEqual([
      [100, 200, 200, 100],
      [500, 200, 200, 100]
    ])
    expect(pictured[0].rotation).toBeCloseTo(30, 1)
    expect(pictured[1]).toMatchObject({ flipX: true })
    expect(pictured[1].rotation).toBeCloseTo(-30, 1)
  })

  test('text sized to its lines comes back on one line, not broken at its width', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0].id
    const slide = graph.createNode('FRAME', page, { name: 'Slide', width: 1280, height: 720 })
    graph.createNode('TEXT', slide.id, {
      name: 'Greeting',
      x: 600,
      y: 100,
      width: 300,
      height: 80,
      text: 'السَّلَامُ عَلَيْكُمْ',
      fontFamily: 'Noto Naskh Arabic',
      fontSize: 44,
      textDirection: 'RTL',
      textAlignHorizontal: 'RIGHT',
      textAutoResize: 'WIDTH_AND_HEIGHT'
    })
    const result = await io.exportContent(
      'pptx',
      { graph, target: { scope: 'node', nodeId: slide.id } },
      { rasterize: () => Promise.resolve(null) }
    )
    if (typeof result.data === 'string') throw new Error('PPTX is binary')
    const again = (await io.readDocument({ name: 'deck.pptx', data: new Uint8Array(result.data) }))
      .graph
    const text = expectDefined(
      again
        .getChildren(again.getChildren(again.getPages()[0].id)[0].id)
        .find((node) => node.type === 'TEXT')
    )
    expect(text).toMatchObject({
      text: 'السَّلَامُ عَلَيْكُمْ',
      textAutoResize: 'WIDTH_AND_HEIGHT',
      textDirection: 'RTL',
      textAlignHorizontal: 'RIGHT'
    })
  })
})
