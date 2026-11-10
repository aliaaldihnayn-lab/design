import { describe, expect, setDefaultTimeout, test } from 'bun:test'

import { FigmaAPI } from '@lawha/core/figma-api'
import { createCanvasKitRasterCodec, initCanvasKit } from '@lawha/core/io/formats/raster'
import { ALL_TOOLS } from '@lawha/core/tools'
import { SceneGraph } from '@lawha/scene-graph'
import { LAWHA_PLUGIN_DATA, readPluginData } from '@lawha/scene-graph/plugin-data'

setDefaultTimeout(60_000)

function tool(name: string) {
  const found = ALL_TOOLS.find((t) => t.name === name)
  if (!found) throw new Error(`${name} missing`)
  return (figma: FigmaAPI, args: Record<string, unknown>) => found.execute(figma, args)
}

async function setup() {
  const graph = new SceneGraph()
  const node = graph.createNode('RECTANGLE', graph.getPages()[0].id, {
    width: 40,
    height: 20,
    fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1, visible: true }]
  })
  const figma = new FigmaAPI(graph)
  const codec = createCanvasKitRasterCodec(await initCanvasKit())
  figma.rasterCodec = codec
  const paint = () => {
    const marker = readPluginData(graph.getNode(node.id)?.pluginData, LAWHA_PLUGIN_DATA.paintLayer)
    const bytes = marker ? graph.images.get(marker.hash) : undefined
    return bytes ? codec.decode(bytes) : null
  }
  return { figma, graph, id: node.id, paint }
}

describe('pixel tools for agents', () => {
  test('paint_pixels draws a stroke into a paint layer over the solid fill', async () => {
    const { figma, graph, id, paint } = await setup()
    const result = tool('paint_pixels')(figma, {
      id,
      color: '#ff0000',
      size: 4,
      hardness: 1,
      points: [
        { x: 2, y: 10 },
        { x: 38, y: 10 }
      ]
    })
    expect(result).toMatchObject({ grid: { width: 40, height: 20 } })
    expect(graph.getNode(id)?.fills).toHaveLength(2)
    const pixels = paint()
    expect(pixels?.data[(10 * 40 + 20) * 4 + 3]).toBe(255)
    expect(pixels?.data[(2 * 40 + 20) * 4 + 3]).toBe(0)
  })

  test('fill_pixels fills like pixels, and sample_pixel_color reads them', async () => {
    const { figma, id } = await setup()
    expect(tool('fill_pixels')(figma, { id, x: 5, y: 5, color: '#00ff00' })).toMatchObject({
      filled_pixels: 800
    })
    expect(tool('sample_pixel_color')(figma, { id, x: 30, y: 15 })).toEqual({
      hex: '#00FF00',
      alpha: 1
    })
  })

  test('refuses layers that cannot hold paint', async () => {
    const { figma, graph } = await setup()
    const text = graph.createNode('TEXT', graph.getPages()[0].id, { width: 10, height: 10 })
    expect(tool('paint_pixels')(figma, { id: text.id, points: [{ x: 1, y: 1 }] })).toHaveProperty(
      'error'
    )
  })
})

describe('mask_layer_from_selection', () => {
  test('masks a layer with an ellipse, inverted', async () => {
    const { figma, graph, id } = await setup()
    const result = tool('mask_layer_from_selection')(figma, {
      id,
      shape: 'ellipse',
      rect: { x: 0, y: 0, width: 40, height: 20 },
      invert: true
    })
    expect(result).toMatchObject({ layer_id: id })
    const group = graph.getNode(String((result as { group_id: string }).group_id))
    expect(group?.childIds).toHaveLength(2)
    expect(graph.getNode(group?.childIds[0] ?? '')?.isMask).toBe(true)
  })

  test('refuses an empty selection', async () => {
    const { figma, id } = await setup()
    expect(
      tool('mask_layer_from_selection')(figma, {
        id,
        shape: 'rect',
        rect: { x: 0, y: 0, width: 0, height: 0 }
      })
    ).toHaveProperty('error')
  })
})

describe('clone_pixels', () => {
  test('clones the layer from a source point', async () => {
    const { figma, id, paint } = await setup()
    tool('fill_pixels')(figma, { id, x: 5, y: 5, color: '#0000ff' })
    tool('paint_pixels')(figma, {
      id,
      color: '#ff0000',
      size: 4,
      hardness: 1,
      points: [{ x: 5, y: 10 }]
    })
    expect(
      tool('clone_pixels')(figma, {
        id,
        source: { x: 5, y: 10 },
        points: [{ x: 30, y: 10 }],
        size: 4,
        hardness: 1
      })
    ).toEqual({ id })
    expect(paint()?.data[(10 * 40 + 30) * 4]).toBe(255)
  })
})
