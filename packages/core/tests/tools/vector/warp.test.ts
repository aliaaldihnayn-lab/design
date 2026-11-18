import { afterEach, describe, expect, test } from 'bun:test'

import { SkiaRenderer } from '@lawha/core/canvas'
import { FigmaAPI } from '@lawha/core/figma-api'
import { initCanvasKit } from '@lawha/core/io/formats/raster'
import { ALL_TOOLS } from '@lawha/core/tools'
import { flatMesh, meshFunction, warpFunction } from '@lawha/core/vector'
import { SceneGraph, type SceneNode } from '@lawha/scene-graph'
import { WARP_PRESETS } from '@lawha/scene-graph/path-effects'

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

function createdNode(graph: SceneGraph, result: unknown): SceneNode {
  if (!result || typeof result !== 'object' || !('created' in result))
    throw new Error(`no result: ${JSON.stringify(result)}`)
  const [first] = result.created as { id: string }[]
  const node = graph.getNode(first.id)
  if (!node) throw new Error('created node missing')
  return node
}

const box = { x: 0, y: 0, width: 200, height: 100 }

describe('warp presets', () => {
  test('a bend of 0 leaves every preset as it is', () => {
    for (const preset of WARP_PRESETS) {
      const warp = warpFunction(box, { preset, bend: 0 })
      for (const point of [
        { x: 0, y: 0 },
        { x: 150, y: 20 },
        { x: 200, y: 100 }
      ]) {
        const moved = warp(point)
        expect(moved.x).toBeCloseTo(point.x, 6)
        expect(moved.y).toBeCloseTo(point.y, 6)
      }
    }
  })

  test('an arch lifts the middle of the box and keeps its ends', () => {
    const warp = warpFunction(box, { preset: 'arch', bend: 0.5 })
    expect(warp({ x: 100, y: 0 }).y).toBeCloseTo(-25, 6)
    expect(warp({ x: 0, y: 0 }).y).toBeCloseTo(0, 6)
  })

  test('an arc keeps the middle line through the centre and bends its ends down', () => {
    const warp = warpFunction(box, { preset: 'arc', bend: 0.5 })
    expect(warp({ x: 100, y: 50 }).y).toBeCloseTo(50, 6)
    expect(warp({ x: 0, y: 50 }).y).toBeGreaterThan(50)
    expect(warp({ x: 200, y: 50 }).y).toBeCloseTo(warp({ x: 0, y: 50 }).y, 6)
  })

  test('a mesh moves the points of a cell with its corners', () => {
    const mesh = flatMesh(box, 1, 1)
    mesh.points[0] = { x: -20, y: 0 }
    const map = meshFunction(box, mesh)
    expect(map({ x: 0, y: 0 })).toEqual({ x: -20, y: 0 })
    expect(map({ x: 0, y: 50 }).x).toBeCloseTo(-10, 6)
    expect(map({ x: 200, y: 100 })).toEqual({ x: 200, y: 100 })
  })
})

describe('warp tools', () => {
  test('warp_shape replaces the layer with its arched outline, keeping its paint', async () => {
    const { graph, figma, pageId, rect } = await setup()
    const node = createdNode(
      graph,
      tool('warp_shape').execute(figma, { ids: [rect.id], preset: 'arch', bend: 0.5 })
    )
    expect(graph.getNode(rect.id)).toBeUndefined()
    expect(graph.getNode(pageId)?.childIds).toEqual([node.id])
    expect(node).toMatchObject({ type: 'VECTOR', name: 'Banner', fills: [RED] })
    expect(node.y).toBeCloseTo(100 - 12.5, 0)
    expect(node.x).toBeCloseTo(100, 0)
    expect(node.width).toBeCloseTo(200, 0)
  })

  test('envelope_mesh pulls a corner out', async () => {
    const { graph, figma, rect } = await setup()
    const node = createdNode(
      graph,
      tool('envelope_mesh').execute(figma, {
        id: rect.id,
        rows: 2,
        columns: 2,
        moves: [{ row: 0, column: 0, dx: -30, dy: -10 }]
      })
    )
    expect(node.x).toBeCloseTo(70, 0)
    expect(node.y).toBeCloseTo(90, 0)
  })

  test('envelope_mesh refuses a point outside its grid', async () => {
    const { figma, rect } = await setup()
    expect(
      tool('envelope_mesh').execute(figma, {
        id: rect.id,
        rows: 1,
        columns: 1,
        moves: [{ row: 3, column: 0, dx: 1, dy: 1 }]
      })
    ).toEqual({ error: 'Grid point 3,0 is outside a 1×1 mesh' })
  })
})
