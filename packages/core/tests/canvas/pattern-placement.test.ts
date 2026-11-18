import { describe, expect, test } from 'bun:test'

import { SkiaRenderer } from '@lawha/core/canvas'
import { initCanvasKit } from '@lawha/core/io/formats/raster'
import { SceneGraph, type Fill } from '@lawha/scene-graph'

import { patternPlacementMatrix } from '#core/canvas/fills'

async function renderer() {
  const ck = await initCanvasKit()
  const surface = ck.MakeSurface(10, 10)
  if (!surface) throw new Error('Could not create CanvasKit surface')
  return new SkiaRenderer(ck, surface)
}

const pattern = (patch: Partial<Fill>): Fill => ({
  type: 'PATTERN',
  color: { r: 0, g: 0, b: 0, a: 1 },
  opacity: 1,
  visible: true,
  ...patch
})

function map(m: number[], x: number, y: number) {
  return [m[0] * x + m[1] * y + m[2], m[3] * x + m[4] * y + m[5]].map(
    (n) => Math.round(n * 1000) / 1000
  )
}

describe('pattern placement matrix', () => {
  const graph = new SceneGraph()
  const node = graph.createNode('RECTANGLE', graph.getPages()[0].id, { width: 100, height: 50 })

  test('a pattern that neither moves nor turns needs no matrix', async () => {
    const r = await renderer()
    expect(patternPlacementMatrix(r, pattern({}), node)).toBeUndefined()
    r.destroy()
  })

  test('an offset moves the tiles by its pixels', async () => {
    const r = await renderer()
    const m = patternPlacementMatrix(r, pattern({ patternOffset: { x: 8, y: -4 } }), node)
    expect(map(Array.from(m ?? []), 0, 0)).toEqual([8, -4])
    r.destroy()
  })

  test('a turn goes about the layer middle, which stays put', async () => {
    const r = await renderer()
    const m = Array.from(patternPlacementMatrix(r, pattern({ patternRotation: 90 }), node) ?? [])
    expect(map(m, 50, 25)).toEqual([50, 25])
    // The tile origin turns a quarter clockwise round the middle.
    expect(map(m, 0, 0)).toEqual([75, -25])
    r.destroy()
  })
})
