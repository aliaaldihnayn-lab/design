import { afterEach, describe, expect, test } from 'bun:test'

import { SkiaRenderer } from '@lawha/core/canvas'
import { FigmaAPI } from '@lawha/core/figma-api'
import { initCanvasKit } from '@lawha/core/io/formats/raster'
import { ALL_TOOLS } from '@lawha/core/tools'
import { SceneGraph, type SceneNode } from '@lawha/scene-graph'
import { LAWHA_PLUGIN_DATA, readPluginData } from '@lawha/scene-graph/plugin-data'

const cleanups: (() => void)[] = []

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

function run(figma: FigmaAPI, name: string, args: Record<string, unknown>) {
  const found = ALL_TOOLS.find((t) => t.name === name)
  if (!found) throw new Error(`${name} missing`)
  return found.execute(figma, args)
}

const solid = (r: number, b: number) => ({
  type: 'SOLID' as const,
  color: { r, g: 0, b, a: 1 },
  opacity: 1,
  visible: true
})

async function setup() {
  const graph = new SceneGraph()
  const pageId = graph.getPages()[0].id
  const from = graph.createNode('ELLIPSE', pageId, {
    name: 'From',
    x: 0,
    y: 0,
    width: 20,
    height: 20,
    fills: [solid(1, 0)]
  })
  const to = graph.createNode('ELLIPSE', pageId, {
    name: 'To',
    x: 180,
    y: 0,
    width: 20,
    height: 20,
    fills: [solid(0, 1)]
  })
  const figma = new FigmaAPI(graph)
  const ck = await initCanvasKit()
  const surface = ck.MakeSurface(100, 100)
  if (!surface) throw new Error('Could not create CanvasKit surface')
  const renderer = new SkiaRenderer(ck, surface)
  figma.setRenderer(renderer)
  cleanups.push(() => renderer.destroy())
  return { graph, figma, pageId, from, to }
}

function blendOf(graph: SceneGraph, id: string) {
  const node = graph.getNode(id)
  return node ? readPluginData(node.pluginData, LAWHA_PLUGIN_DATA.liveBlend) : undefined
}

function children(graph: SceneGraph, id: string): SceneNode[] {
  return (graph.getNode(id)?.childIds ?? []).flatMap((child) => graph.getNode(child) ?? [])
}

async function blend(figma: FigmaAPI, from: SceneNode, to: SceneNode, extra = {}) {
  const result = await run(figma, 'blend_shapes', {
    from_id: from.id,
    to_id: to.id,
    steps: 3,
    ...extra
  })
  if (!result || typeof result !== 'object' || !('id' in result))
    throw new Error(JSON.stringify(result))
  return String(result.id)
}

describe('live blend', () => {
  test('groups the ends with their steps and keeps the blend on the group', async () => {
    const { graph, figma, from, to } = await setup()
    const id = await blend(figma, from, to)
    expect(children(graph, id).map((node) => node.name)).toEqual([
      'From',
      'Blend 1',
      'Blend 2',
      'Blend 3',
      'To'
    ])
    expect(blendOf(graph, id)).toMatchObject({ spacing: 'steps', steps: 3 })
  })

  test('changing the steps makes them again; distance spacing counts them from the gap', async () => {
    const { graph, figma, from, to } = await setup()
    const id = await blend(figma, from, to)
    await run(figma, 'edit_blend', { id, steps: 5 })
    expect(children(graph, id)).toHaveLength(7)
    // 180 px between the middles at 30 px apart is 5 steps.
    await run(figma, 'edit_blend', { id, spacing: 'distance', distance: 30 })
    expect(children(graph, id)).toHaveLength(7)
    await run(figma, 'edit_blend', { id, distance: 60 })
    expect(children(graph, id)).toHaveLength(4)
  })

  test('a spine carries the steps along it and the ends to its ends', async () => {
    const { graph, figma, pageId, from, to } = await setup()
    const spine = graph.createNode('VECTOR', pageId, {
      name: 'Spine',
      x: 0,
      y: 100,
      width: 200,
      height: 100,
      vectorNetwork: {
        vertices: [
          { x: 0, y: 100 },
          { x: 100, y: 0 },
          { x: 200, y: 100 }
        ],
        segments: [
          { start: 0, end: 1, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
          { start: 1, end: 2, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } }
        ],
        regions: []
      },
      fills: [],
      strokes: [{ ...solid(0, 0), weight: 1, align: 'CENTER' }]
    })
    const id = await blend(figma, from, to, { steps: 1, spine_id: spine.id })
    const nodes = children(graph, id)
    const step = nodes.find((node) => node.name === 'Blend 1')
    // Layers in a group are placed in the group; the page sees them moved by its place.
    const groupY = graph.getNode(id)?.y ?? 0
    // The one step sits at the spine's middle, its peak, and the spine stops drawing.
    expect(Math.round(groupY + (step?.y ?? 0) + (step?.height ?? 0) / 2)).toBe(100)
    expect(graph.getNode(spine.id)?.visible).toBe(false)
    // The first end's middle is at the spine's start.
    expect(Math.round(groupY + (graph.getNode(from.id)?.y ?? 0) + 10)).toBe(200)
  })

  test('release leaves the ends; expand keeps the steps as vectors', async () => {
    const { graph, figma, pageId, from, to } = await setup()
    const id = await blend(figma, from, to)
    await run(figma, 'release_blend', { id })
    expect(graph.getNode(id)).toBeUndefined()
    expect(children(graph, pageId).map((node) => node.name)).toEqual(['From', 'To'])

    const again = await blend(figma, from, to)
    await run(figma, 'expand_blend', { id: again })
    expect(blendOf(graph, again)).toBeUndefined()
    expect(children(graph, again)).toHaveLength(5)
  })
})
