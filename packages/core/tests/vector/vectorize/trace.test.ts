import { describe, expect, test } from 'bun:test'

import { svgToVectorPaths, traceImage, traceToSVG, type TracePixels } from '@lawha/core/vector'

type Paint = (x: number, y: number) => [number, number, number, number]

function image(width: number, height: number, paint: Paint): TracePixels {
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data.set(paint(x, y), (y * width + x) * 4)
  }
  return { width, height, data }
}

const WHITE: [number, number, number, number] = [255, 255, 255, 255]
const RED: [number, number, number, number] = [220, 20, 30, 255]
const BLUE: [number, number, number, number] = [20, 40, 200, 255]

describe('traceImage', () => {
  test('traces a red disc on white as two stacked colours, the background first', () => {
    const disc = image(64, 64, (x, y) => (Math.hypot(x - 32, y - 32) < 20 ? RED : WHITE))
    const result = traceImage(disc, { colors: 4 })
    expect(result.layers.map((layer) => layer.color)).toEqual([
      [255, 255, 255],
      [220, 20, 30]
    ])
    // The disc is about π·20² pixels.
    expect(result.layers[1].area).toBeGreaterThan(1150)
    expect(result.layers[1].area).toBeLessThan(1350)
    expect(result.layers[1].d).toContain('C')
  })

  test('its SVG imports as vector paths covering the image', () => {
    const disc = image(64, 64, (x, y) => (Math.hypot(x - 32, y - 32) < 20 ? RED : WHITE))
    const imported = svgToVectorPaths(traceToSVG(traceImage(disc, { colors: 2 })), {
      width: 128,
      height: 128
    })
    expect(imported?.paths).toHaveLength(2)
    const xs = (index: number) =>
      imported?.paths[index].vectorNetwork.vertices.map((vertex) => vertex.x) ?? []
    // The background covers the image, scaled to the layer, corners and all.
    expect(Math.min(...xs(0))).toBeCloseTo(0, 5)
    expect(Math.max(...xs(0))).toBeCloseTo(128, 5)
    // The disc is about 80 px across at twice the size.
    expect(Math.max(...xs(1)) - Math.min(...xs(1))).toBeGreaterThan(70)
    expect(Math.max(...xs(1)) - Math.min(...xs(1))).toBeLessThan(90)
  })

  test('keeps a hole: a ring traces as an outline with an inner loop', () => {
    const ring = image(80, 80, (x, y) => {
      const r = Math.hypot(x - 40, y - 40)
      return r < 30 && r > 15 ? BLUE : WHITE
    })
    const blue = traceImage(ring, { colors: 2, stacked: false }).layers.find(
      (layer) => layer.color[0] < 100
    )
    expect(blue?.d.match(/M/g)).toHaveLength(2)
  })

  test('absorbs specks smaller than the noise setting', () => {
    const specks = image(40, 40, (x, y) => (x % 13 === 5 && y % 13 === 5 ? RED : WHITE))
    expect(traceImage(specks, { colors: 2, noise: 4 }).layers).toHaveLength(1)
    expect(traceImage(specks, { colors: 2, noise: 0 }).layers).toHaveLength(2)
  })

  test('skips transparent pixels', () => {
    const square = image(30, 30, (x, y) =>
      x >= 10 && x < 20 && y >= 10 && y < 20 ? RED : [0, 0, 0, 0]
    )
    const { layers } = traceImage(square, { colors: 4 })
    expect(layers).toHaveLength(1)
    expect(layers[0].area).toBe(100)
  })
})
