import { afterEach, describe, expect, test } from 'bun:test'

import { SkiaRenderer } from '@lawha/core/canvas'
import { FigmaAPI } from '@lawha/core/figma-api'
import { initCanvasKit } from '@lawha/core/io/formats/raster'
import { ALL_TOOLS } from '@lawha/core/tools'
import { SceneGraph } from '@lawha/scene-graph'

const cleanups: (() => void)[] = []

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

function tool(name: string) {
  const found = ALL_TOOLS.find((t) => t.name === name)
  if (!found) throw new Error(`${name} missing`)
  return found
}

async function setup(withRenderer = true) {
  const graph = new SceneGraph()
  const pageId = graph.getPages()[0].id
  const frame = graph.createNode('FRAME', pageId, { x: 200, y: 100, width: 300, height: 200 })
  const a = graph.createNode('RECTANGLE', frame.id, { x: 0, y: 0, width: 100, height: 100 })
  const b = graph.createNode('ELLIPSE', frame.id, { x: 50, y: 0, width: 100, height: 100 })
  const figma = new FigmaAPI(graph)
  if (withRenderer) {
    const ck = await initCanvasKit()
    const surface = ck.MakeSurface(100, 100)
    if (!surface) throw new Error('Could not create CanvasKit surface')
    const renderer = new SkiaRenderer(ck, surface)
    figma.setRenderer(renderer)
    cleanups.push(() => renderer.destroy())
  }
  return { graph, figma, frame, a, b }
}

describe('shape builder tools', () => {
  test('lists regions in canvas coordinates with a point inside each', async () => {
    const { figma, a, b } = await setup()
    const result = tool('shape_builder_regions').execute(figma, { ids: [a.id, b.id] })
    if (!result || typeof result !== 'object' || !('regions' in result))
      throw new Error('no regions')
    const regions = result.regions as { covered_by: string[]; point: { x: number } | null }[]
    expect(regions.map((region) => region.covered_by.length).sort((x, y) => x - y)).toEqual([
      1, 1, 2
    ])
    for (const region of regions) expect(region.point?.x).toBeGreaterThanOrEqual(200)
  })

  test('deletes the overlap, keeping the rest of each shape in its frame', async () => {
    const { figma, graph, frame, a, b } = await setup()
    const result = tool('shape_builder').execute(figma, {
      ids: [a.id, b.id],
      points: [{ x: 280, y: 150 }],
      mode: 'delete'
    })
    expect(result).toMatchObject({ removed: [a.id, b.id] })
    const children = (graph.getNode(frame.id)?.childIds ?? []).map((id) => graph.getNode(id))
    expect(children.map((node) => node?.type)).toEqual(['VECTOR', 'VECTOR'])
    // The ellipse loses all of it inside the square, so only its right half is left.
    expect(children[1]?.x).toBeCloseTo(100, 1)
    expect(children[1]?.width).toBeCloseTo(50, 1)
  })

  test('says so without a renderer', async () => {
    const { figma, a, b } = await setup(false)
    expect(
      tool('shape_builder').execute(figma, { ids: [a.id, b.id], points: [{ x: 0, y: 0 }] })
    ).toEqual({
      error: 'Shape Builder needs path geometry, which this host cannot measure'
    })
  })
})
