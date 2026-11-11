import { afterEach, describe, expect, test } from 'bun:test'

import { SkiaRenderer } from '@lawha/core/canvas'
import { FigmaAPI } from '@lawha/core/figma-api'
import { initCanvasKit } from '@lawha/core/io/formats/raster'
import { ALL_TOOLS } from '@lawha/core/tools'
import { SceneGraph, type SceneNode, type Stroke } from '@lawha/scene-graph'
import type { Color } from '@lawha/scene-graph/primitives'

const cleanups: (() => void)[] = []

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

function run(name: string, figma: FigmaAPI, args: Record<string, unknown>) {
  const found = ALL_TOOLS.find((t) => t.name === name)
  if (!found) throw new Error(`${name} missing`)
  return found.execute(figma, args)
}

const RED: Color = { r: 1, g: 0, b: 0, a: 1 }
const BLUE: Color = { r: 0, g: 0, b: 1, a: 1 }
const solid = (color: Color) => ({ type: 'SOLID' as const, color, opacity: 1, visible: true })
const stroke = (weight: number): Stroke => ({ ...solid(BLUE), weight, align: 'CENTER' })

async function setup() {
  const graph = new SceneGraph()
  const pageId = graph.getPages()[0].id
  const figma = new FigmaAPI(graph)
  const ck = await initCanvasKit()
  const surface = ck.MakeSurface(10, 10)
  if (!surface) throw new Error('Could not create CanvasKit surface')
  const renderer = new SkiaRenderer(ck, surface)
  figma.setRenderer(renderer)
  cleanups.push(() => renderer.destroy())
  return { graph, figma, pageId }
}

function created(graph: SceneGraph, result: unknown): SceneNode[] {
  if (!result || typeof result !== 'object' || !('created' in result))
    throw new Error(`no result: ${JSON.stringify(result)}`)
  return (result.created as { id: string }[]).flatMap((item) => graph.getNode(item.id) ?? [])
}

const box = (node: SceneNode | undefined) =>
  node ? [node.x, node.y, node.width, node.height].map((n) => Math.round(n * 10) / 10) : null

describe('offset_path', () => {
  test('grows a square by the distance on every side, under the original', async () => {
    const { graph, figma, pageId } = await setup()
    const square = graph.createNode('RECTANGLE', pageId, {
      name: 'Square',
      x: 50,
      y: 50,
      width: 100,
      height: 100,
      fills: [solid(RED)]
    })
    const [offset] = created(graph, run('offset_path', figma, { ids: [square.id], distance: 10 }))
    expect(box(offset)).toEqual([40, 40, 120, 120])
    expect(offset).toMatchObject({ type: 'VECTOR', name: 'Square (Offset)', fills: [solid(RED)] })
    expect(graph.getNode(pageId)?.childIds).toEqual([offset.id, square.id])
  })

  test('shrinks with a negative distance, and says so when nothing is left', async () => {
    const { graph, figma, pageId } = await setup()
    const square = graph.createNode('RECTANGLE', pageId, { x: 0, y: 0, width: 40, height: 40 })
    const [inset] = created(graph, run('offset_path', figma, { ids: [square.id], distance: -5 }))
    expect(box(inset)).toEqual([5, 5, 30, 30])
    expect(run('offset_path', figma, { ids: [square.id], distance: -30 })).toEqual({
      error: 'Nothing is left after that offset'
    })
  })

  test('round joins round the corners', async () => {
    const { graph, figma, pageId } = await setup()
    const square = graph.createNode('RECTANGLE', pageId, { x: 0, y: 0, width: 40, height: 40 })
    const [offset] = created(
      graph,
      run('offset_path', figma, { ids: [square.id], distance: 10, join: 'ROUND' })
    )
    expect(box(offset)).toEqual([-10, -10, 60, 60])
    // A rounded outline has curves where the square had corners.
    expect(
      offset.vectorNetwork?.segments.some((s) => s.tangentStart.x !== 0 || s.tangentStart.y !== 0)
    ).toBe(true)
  })
})

describe('width_profile', () => {
  test('tapers a line to points at both ends, as a filled vector of its stroke paint', async () => {
    const { graph, figma, pageId } = await setup()
    const line = graph.createNode('LINE', pageId, {
      name: 'Stroke',
      x: 0,
      y: 100,
      width: 200,
      height: 0,
      strokes: [stroke(20)]
    })
    const [shape] = created(
      graph,
      run('width_profile', figma, { ids: [line.id], profile: 'taper-both' })
    )
    expect(graph.getNode(line.id)).toBeUndefined()
    expect(shape).toMatchObject({ name: 'Stroke (Width)', strokes: [] })
    expect(shape.fills[0]).toMatchObject({ type: 'SOLID', color: BLUE })
    // Full weight in the middle, nothing at the ends; a line's stroke lies above it, as Figma
    // draws a line's stroke to its negative y.
    expect(box(shape)).toEqual([0, 80, 200, 20])
  })

  test('a shape with a fill keeps it without its stroke', async () => {
    const { graph, figma, pageId } = await setup()
    const square = graph.createNode('RECTANGLE', pageId, {
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      fills: [solid(RED)],
      strokes: [stroke(8)]
    })
    created(graph, run('width_profile', figma, { ids: [square.id], points: [{ t: 0, width: 1 }] }))
    expect(graph.getNode(square.id)?.strokes).toEqual([])
    expect(graph.getNode(pageId)?.childIds).toHaveLength(2)
  })
})

describe('blend_shapes', () => {
  test('makes evenly spaced steps between two shapes, colours mixed, grouped with them', async () => {
    const { graph, figma, pageId } = await setup()
    const a = graph.createNode('RECTANGLE', pageId, {
      x: 0,
      y: 0,
      width: 20,
      height: 20,
      fills: [solid(RED)]
    })
    const b = graph.createNode('ELLIPSE', pageId, {
      x: 160,
      y: 0,
      width: 40,
      height: 40,
      fills: [solid(BLUE)]
    })
    const result = run('blend_shapes', figma, { from_id: a.id, to_id: b.id, steps: 3 })
    if (!result || typeof result !== 'object' || !('steps' in result)) throw new Error('no blend')
    const steps = (result.steps as string[]).map((id) => graph.getNode(id))
    expect(steps.map((step) => Math.round(step?.x ?? -1))).toEqual([40, 80, 120])
    const middle = steps[1]?.fills[0]
    expect(middle?.type === 'SOLID' ? middle.color : null).toEqual({ r: 0.5, g: 0, b: 0.5, a: 1 })
    const group = graph.getNode(String('id' in result ? result.id : ''))
    expect(group).toMatchObject({ type: 'GROUP', name: 'Blend' })
    expect(group?.childIds).toEqual([a.id, ...(result.steps as string[]), b.id])
  })
})

describe('set_pattern_fill', () => {
  test('fills a layer with a pattern tiled from another', async () => {
    const { graph, figma, pageId } = await setup()
    const tile = graph.createNode('ELLIPSE', pageId, { width: 10, height: 10 })
    const target = graph.createNode('RECTANGLE', pageId, { width: 100, height: 100 })
    expect(
      run('set_pattern_fill', figma, {
        ids: [target.id],
        source_id: tile.id,
        scale: 2,
        spacing_x: 0.5,
        tile_type: 'HORIZONTAL_HEXAGONAL'
      })
    ).toEqual({ updated: [target.id], source_id: tile.id })
    expect(graph.getNode(target.id)?.fills).toEqual([
      expect.objectContaining({
        type: 'PATTERN',
        sourceNodeId: tile.id,
        scale: 2,
        patternSpacing: { x: 0.5, y: 0 },
        patternTileType: 'HORIZONTAL_HEXAGONAL'
      })
    ])
  })

  test('moves and turns the tiles', async () => {
    const { graph, figma, pageId } = await setup()
    const tile = graph.createNode('COMPONENT', pageId, { width: 10, height: 10 })
    const target = graph.createNode('RECTANGLE', pageId, { width: 100, height: 100 })
    run('set_pattern_fill', figma, {
      ids: [target.id],
      source_id: tile.id,
      offset_x: 5,
      offset_y: -3,
      rotation: 45
    })
    expect(graph.getNode(target.id)?.fills[0]).toMatchObject({
      sourceNodeId: tile.id,
      patternOffset: { x: 5, y: -3 },
      patternRotation: 45
    })
  })

  test('refuses to fill a layer with itself', async () => {
    const { graph, figma, pageId } = await setup()
    const tile = graph.createNode('RECTANGLE', pageId, { width: 10, height: 10 })
    expect(run('set_pattern_fill', figma, { ids: [tile.id], source_id: tile.id })).toEqual({
      error: 'A layer cannot be filled with itself'
    })
  })
})

describe('outline_stroke', () => {
  test('replaces a stroked shape with its fill under its stroke', async () => {
    const { graph, figma, pageId } = await setup()
    const square = graph.createNode('RECTANGLE', pageId, {
      name: 'Box',
      width: 50,
      height: 50,
      fills: [solid(RED)],
      strokes: [stroke(4)]
    })
    const made = created(graph, run('outline_stroke', figma, { ids: [square.id] }))
    expect(made.map((node) => node.name)).toEqual(['Box', 'Box (Stroke)'])
    expect(graph.getNode(square.id)).toBeUndefined()
  })
})
