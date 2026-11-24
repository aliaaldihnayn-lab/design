import { afterAll, describe, expect, test } from 'bun:test'

import { SkiaRenderer } from '@lawha/core/canvas'
import { initCanvasKit, renderNodesToImage } from '@lawha/core/io/formats/raster'
import { SceneGraph, type Fill } from '@lawha/scene-graph'

import { expectDefined } from '../helpers/assert'

const ck = await initCanvasKit()
const renderer = new SkiaRenderer(ck, expectDefined(ck.MakeSurface(1, 1)))
afterAll(() => renderer.destroy())

const solid = (r: number, g: number, b: number): Fill => ({
  type: 'SOLID',
  color: { r, g, b, a: 1 },
  opacity: 1,
  visible: true
})

/**
 * A 100 × 80 layer filled with a pattern of a 20 px white tile whose 10 px red square sits in
 * the middle, read back as the colour at each point: red, white, or black where nothing draws.
 */
function colorsAt(fill: Partial<Fill>, points: [number, number][]): string[] {
  const graph = new SceneGraph()
  const page = graph.getPages()[0].id
  const tile = graph.createNode('FRAME', page, {
    x: 500,
    y: 500,
    width: 20,
    height: 20,
    fills: [solid(1, 1, 1)]
  })
  graph.createNode('RECTANGLE', tile.id, {
    x: 5,
    y: 5,
    width: 10,
    height: 10,
    fills: [solid(1, 0, 0)]
  })
  const frame = graph.createNode('FRAME', page, { width: 100, height: 80, fills: [solid(0, 0, 0)] })
  graph.createNode('RECTANGLE', frame.id, {
    width: 100,
    height: 80,
    fills: [
      {
        type: 'PATTERN',
        color: { r: 0, g: 0, b: 0, a: 1 },
        opacity: 1,
        visible: true,
        sourceNodeId: tile.id,
        scale: 1,
        patternSpacing: { x: 0, y: 0 },
        ...fill
      }
    ]
  })
  const png = expectDefined(
    renderNodesToImage(ck, renderer, graph, page, [frame.id], {
      scale: 1,
      format: 'PNG',
      trimTransparent: false
    })
  )
  const image = expectDefined(ck.MakeImageFromEncoded(png))
  try {
    return points.map(([x, y]) => {
      const [r, g, b] = expectDefined(
        image.readPixels(x, y, {
          width: 1,
          height: 1,
          alphaType: ck.AlphaType.Unpremul,
          colorType: ck.ColorType.RGBA_8888,
          colorSpace: ck.ColorSpace.SRGB
        })
      )
      if (r > 200 && g < 60 && b < 60) return 'red'
      if (r > 200 && g > 200 && b > 200) return 'white'
      if (r < 60 && g < 60 && b < 60) return 'black'
      return `rgb(${r},${g},${b})`
    })
  } finally {
    image.delete()
  }
}

describe('a pattern fill tiles its source layer', () => {
  test('with the layers inside it, not only its own fill', () => {
    // The middle of the first and second tiles, and a tile corner.
    expect(
      colorsAt({}, [
        [10, 10],
        [30, 10],
        [1, 1]
      ])
    ).toEqual(['red', 'red', 'white'])
  })

  test('in brick rows: every other row moved half a tile, each tile whole', () => {
    // Second row (y 20–40) is shifted 10 px: its squares sit at x 15–25, 35–45, and the one
    // that crosses the left edge comes back in at x 0–5, with white up to x 15.
    expect(
      colorsAt({ patternTileType: 'HORIZONTAL_HEXAGONAL' }, [
        [10, 10],
        [10, 30],
        [20, 30],
        [2, 30],
        [7, 30],
        [10, 50]
      ])
    ).toEqual(['red', 'white', 'red', 'red', 'white', 'red'])
  })

  test('in brick columns: every other column moved half a tile, each tile whole', () => {
    expect(
      colorsAt({ patternTileType: 'VERTICAL_HEXAGONAL' }, [
        [10, 10],
        [30, 10],
        [30, 20],
        [30, 2],
        [30, 7],
        [50, 10]
      ])
    ).toEqual(['red', 'white', 'red', 'red', 'white', 'red'])
  })
})
