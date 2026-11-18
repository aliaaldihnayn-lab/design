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

function tool(name: string) {
  const found = ALL_TOOLS.find((t) => t.name === name)
  if (!found) throw new Error(`${name} missing`)
  return found
}

const RED = { type: 'SOLID' as const, color: { r: 1, g: 0, b: 0, a: 1 }, opacity: 1, visible: true }

async function setup() {
  const graph = new SceneGraph()
  const pageId = graph.getPages()[0].id
  const rect = graph.createNode('RECTANGLE', pageId, {
    name: 'Banner',
    x: 100,
    y: 100,
    width: 200,
    height: 50,
    fills: [RED]
  })
  const figma = new FigmaAPI(graph)
  const ck = await initCanvasKit()
  const surface = ck.MakeSurface(100, 100)
  if (!surface) throw new Error('Could not create CanvasKit surface')
  const renderer = new SkiaRenderer(ck, surface)
  figma.setRenderer(renderer)
  cleanups.push(() => renderer.destroy())
  return { graph, figma, pageId, rect }
}

async function run(figma: FigmaAPI, name: string, args: Record<string, unknown>) {
  return tool(name).execute(figma, args)
}

function createdNode(graph: SceneGraph, result: unknown): SceneNode {
  if (!result || typeof result !== 'object' || !('created' in result))
    throw new Error(`no result: ${JSON.stringify(result)}`)
  const [first] = result.created as { id: string }[]
  const node = graph.getNode(first.id)
  if (!node) throw new Error('created node missing')
  return node
}

const effectOf = (node: SceneNode | undefined) =>
  node ? readPluginData(node.pluginData, LAWHA_PLUGIN_DATA.pathEffect) : undefined

const boxOf = (node: SceneNode | undefined) =>
  node ? [node.x, node.y, node.width, node.height].map((n) => Math.round(n)) : null

describe('live warp', () => {
  test('keeps the warp and the outline it bent, and edits it again from that outline', async () => {
    const { graph, figma, rect } = await setup()
    const warped = createdNode(
      graph,
      await run(figma, 'warp_shape', { ids: [rect.id], preset: 'arch', bend: 0.5 })
    )
    expect(effectOf(warped)).toMatchObject({ kind: 'warp', preset: 'arch', bend: 0.5 })
    const archBox = boxOf(warped)

    // Bending back to zero gives the rectangle's box again: the original outline was kept.
    await run(figma, 'edit_path_effect', { id: warped.id, bend: 0 })
    expect(boxOf(graph.getNode(warped.id))).toEqual([100, 100, 200, 50])
    await run(figma, 'edit_path_effect', { id: warped.id, bend: 0.5 })
    expect(boxOf(graph.getNode(warped.id))).toEqual(archBox)
  })

  test('follows the vector when it moves', async () => {
    const { graph, figma, rect } = await setup()
    const warped = createdNode(
      graph,
      await run(figma, 'warp_shape', { ids: [rect.id], preset: 'bulge', bend: 0.4 })
    )
    graph.updateNode(warped.id, { x: warped.x + 50 })
    await run(figma, 'edit_path_effect', { id: warped.id, bend: 0 })
    expect(boxOf(graph.getNode(warped.id))).toEqual([150, 100, 200, 50])
  })

  test('expand drops the effect and keeps the shape; release returns the outline', async () => {
    const { graph, figma, rect } = await setup()
    const warped = createdNode(
      graph,
      await run(figma, 'warp_shape', { ids: [rect.id], preset: 'flag', bend: 0.6 })
    )
    const released = createdNode(
      graph,
      await run(figma, 'release_path_effect', { ids: [warped.id] })
    )
    expect(effectOf(released)).toBeUndefined()
    expect(boxOf(released)).toEqual([100, 100, 200, 50])
    expect(released.fills[0]).toMatchObject({ color: RED.color })

    const again = createdNode(
      graph,
      await run(figma, 'warp_shape', { ids: [released.id], preset: 'flag', bend: 0.6 })
    )
    const shape = boxOf(again)
    await run(figma, 'expand_path_effect', { ids: [again.id] })
    expect(effectOf(graph.getNode(again.id))).toBeUndefined()
    expect(boxOf(graph.getNode(again.id))).toEqual(shape)
    expect(await run(figma, 'edit_path_effect', { id: again.id, bend: 0 })).toMatchObject({
      error: expect.stringContaining('no live')
    })
  })

  test('expand: true leaves no live warp, as before', async () => {
    const { graph, figma, rect } = await setup()
    const warped = createdNode(
      graph,
      await run(figma, 'warp_shape', { ids: [rect.id], preset: 'arc', bend: 0.5, expand: true })
    )
    expect(effectOf(warped)).toBeUndefined()
  })
})

describe('live envelope mesh', () => {
  test('a flat mesh changes nothing, and moving a point moves that corner', async () => {
    const { graph, figma, rect } = await setup()
    const meshed = createdNode(
      graph,
      await run(figma, 'envelope_mesh', { id: rect.id, rows: 2, columns: 2 })
    )
    expect(boxOf(meshed)).toEqual([100, 100, 200, 50])
    expect(effectOf(meshed)).toMatchObject({ kind: 'mesh', rows: 2, columns: 2 })

    await run(figma, 'edit_path_effect', {
      id: meshed.id,
      moves: [{ row: 0, column: 0, dx: -20, dy: -10 }]
    })
    expect(boxOf(graph.getNode(meshed.id))).toEqual([80, 90, 220, 60])
  })

  test('a curve handle bends the edge it belongs to', async () => {
    const { graph, figma, rect } = await setup()
    const meshed = createdNode(
      graph,
      await run(figma, 'envelope_mesh', { id: rect.id, rows: 1, columns: 1 })
    )
    // The top left point's right handle pulled 40 px up bows the top edge upwards.
    await run(figma, 'edit_path_effect', {
      id: meshed.id,
      handles: [{ row: 0, column: 0, side: 'right', dx: 66, dy: -40 }]
    })
    const bent = graph.getNode(meshed.id)
    expect(bent?.y).toBeLessThan(95)
    expect(bent?.y).toBeGreaterThan(60)
    expect(Math.round((bent?.y ?? 0) + (bent?.height ?? 0))).toBe(150)
  })

  test('adding rows and columns keeps the shape and makes a larger grid', async () => {
    const { graph, figma, rect } = await setup()
    const meshed = createdNode(
      graph,
      await run(figma, 'envelope_mesh', {
        id: rect.id,
        rows: 1,
        columns: 1,
        moves: [{ row: 1, column: 1, dx: 30, dy: 20 }]
      })
    )
    const before = boxOf(meshed)
    await run(figma, 'edit_path_effect', { id: meshed.id, rows: 3, columns: 4 })
    const node = graph.getNode(meshed.id)
    const effect = effectOf(node)
    expect(effect?.kind === 'mesh' ? effect.points.length : 0).toBe(4 * 5)
    expect(boxOf(node)).toEqual(before)
  })
})

describe('live width profile', () => {
  async function strokedLine() {
    const context = await setup()
    const line = context.graph.createNode('VECTOR', context.pageId, {
      name: 'Line',
      x: 0,
      y: 0,
      width: 200,
      height: 0,
      vectorNetwork: {
        vertices: [
          { x: 0, y: 0 },
          { x: 200, y: 0 }
        ],
        segments: [{ start: 0, end: 1, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } }],
        regions: []
      },
      fills: [],
      strokes: [{ ...RED, weight: 10, align: 'CENTER' }],
      strokeWeight: 10
    })
    return { ...context, line }
  }

  test('keeps the centre line and weight, and edits the width points', async () => {
    const { graph, figma, line } = await strokedLine()
    const shaped = createdNode(
      graph,
      await run(figma, 'width_profile', { ids: [line.id], profile: 'uniform' })
    )
    expect(effectOf(shaped)).toMatchObject({ kind: 'width', weight: 10 })
    expect(Math.round(shaped.height)).toBe(10)

    await run(figma, 'edit_path_effect', {
      id: shaped.id,
      points: [
        { t: 0, width: 3 },
        { t: 1, width: 3 }
      ]
    })
    expect(Math.round(graph.getNode(shaped.id)?.height ?? 0)).toBe(30)
  })

  test('release gives the stroked line back', async () => {
    const { graph, figma, line } = await strokedLine()
    const shaped = createdNode(
      graph,
      await run(figma, 'width_profile', { ids: [line.id], profile: 'bulge' })
    )
    const released = createdNode(
      graph,
      await run(figma, 'release_path_effect', { ids: [shaped.id] })
    )
    expect(released.fills).toEqual([])
    expect(released.strokes[0]).toMatchObject({ color: RED.color, weight: 10 })
    expect(Math.round(released.width)).toBe(200)
  })
})
