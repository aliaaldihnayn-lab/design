import { afterEach, describe, expect, test } from 'bun:test'

import { SkiaRenderer } from '@lawha/core/canvas'
import { FigmaAPI } from '@lawha/core/figma-api'
import { initCanvasKit } from '@lawha/core/io/formats/raster'
import { ALL_TOOLS } from '@lawha/core/tools'
import { SceneGraph, type SceneNode } from '@lawha/scene-graph'
import { getWorldMatrix } from '@lawha/scene-graph/coordinate'
import Matrix from '@lawha/scene-graph/matrix'

const cleanups: (() => void)[] = []

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

const tool = ALL_TOOLS.find((t) => t.name === 'image_trace')
if (!tool) throw new Error('image_trace missing')
const imageTrace = tool

/** A 120 px PNG: a red disc and a blue bar on white. */
async function encodedImage() {
  const ck = await initCanvasKit()
  const surface = ck.MakeSurface(120, 120)
  if (!surface) throw new Error('Could not create CanvasKit surface')
  const canvas = surface.getCanvas()
  canvas.clear(ck.WHITE)
  const paint = new ck.Paint()
  paint.setAntiAlias(true)
  paint.setColor(ck.Color(220, 20, 30, 1))
  canvas.drawCircle(40, 40, 25, paint)
  paint.setColor(ck.Color(20, 40, 200, 1))
  canvas.drawRect(ck.LTRBRect(10, 90, 110, 110), paint)
  paint.delete()
  const snapshot = surface.makeImageSnapshot()
  const bytes = snapshot.encodeToBytes()
  snapshot.delete()
  surface.delete()
  if (!bytes) throw new Error('Could not encode the image')
  return { ck, bytes }
}

async function setup() {
  const { ck, bytes } = await encodedImage()
  const graph = new SceneGraph()
  const pageId = graph.getPages()[0].id
  const hash = 'a'.repeat(40)
  graph.images.set(hash, bytes)
  const photo = graph.createNode('RECTANGLE', pageId, {
    name: 'Photo',
    x: 10,
    y: 20,
    width: 240,
    height: 240,
    fills: [
      {
        type: 'IMAGE',
        imageHash: hash,
        imageScaleMode: 'FILL',
        color: { r: 0, g: 0, b: 0, a: 1 },
        opacity: 1,
        visible: true
      }
    ]
  })
  const figma = new FigmaAPI(graph)
  const surface = ck.MakeSurface(10, 10)
  if (!surface) throw new Error('Could not create CanvasKit surface')
  const renderer = new SkiaRenderer(ck, surface)
  figma.setRenderer(renderer)
  cleanups.push(() => renderer.destroy())
  return { graph, figma, pageId, photo }
}

/**
 * A 100 px transparent image with a red square at x 60–90, y 10–40, on a 200 × 100 layer at
 * 100, 100 painted by `props`, traced: the page box of each traced shape.
 */
async function tracedBoxes(props: Partial<SceneNode>, scaleMode: 'FILL' | 'FIT') {
  const ck = await initCanvasKit()
  const surface = ck.MakeSurface(100, 100)
  if (!surface) throw new Error('Could not create CanvasKit surface')
  const paint = new ck.Paint()
  paint.setColor(ck.Color(220, 20, 30, 1))
  surface.getCanvas().clear(ck.TRANSPARENT)
  surface.getCanvas().drawRect(ck.LTRBRect(60, 10, 90, 40), paint)
  paint.delete()
  const snapshot = surface.makeImageSnapshot()
  const bytes = snapshot.encodeToBytes()
  snapshot.delete()
  surface.delete()
  if (!bytes) throw new Error('Could not encode the image')
  const graph = new SceneGraph()
  const hash = 'b'.repeat(40)
  graph.images.set(hash, bytes)
  const photo = graph.createNode('RECTANGLE', graph.getPages()[0].id, {
    x: 100,
    y: 100,
    width: 200,
    height: 100,
    ...props,
    fills: [
      {
        type: 'IMAGE',
        imageHash: hash,
        imageScaleMode: scaleMode,
        color: { r: 0, g: 0, b: 0, a: 1 },
        opacity: 1,
        visible: true
      }
    ]
  })
  const figma = new FigmaAPI(graph)
  const measure = ck.MakeSurface(10, 10)
  if (!measure) throw new Error('Could not create CanvasKit surface')
  const renderer = new SkiaRenderer(ck, measure)
  figma.setRenderer(renderer)
  cleanups.push(() => renderer.destroy())
  const result = imageTrace.execute(figma, { id: photo.id, preset: 'logo' })
  if (!result || typeof result !== 'object' || !('id' in result))
    throw new Error(`no frame: ${JSON.stringify(result)}`)
  const frame = graph.getNode(String(result.id))
  return (frame?.childIds ?? []).map((id) => {
    const node = graph.getNode(id)
    if (!node) throw new Error('missing traced shape')
    const world = getWorldMatrix(node, graph)
    const [a, b] = [
      Matrix.mapPoint(world, { x: 0, y: 0 }),
      Matrix.mapPoint(world, { x: node.width, y: node.height })
    ]
    return [Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y)].map(
      Math.round
    )
  })
}

describe('image_trace', () => {
  test('replaces the image with a frame of traced colour shapes in its place', async () => {
    const { graph, figma, pageId, photo } = await setup()
    const result = imageTrace.execute(figma, { id: photo.id, colors: 3 })
    if (!result || typeof result !== 'object' || !('id' in result))
      throw new Error(`no frame: ${JSON.stringify(result)}`)
    expect(result).toMatchObject({ colors: 3, paths: 3 })
    const frame = graph.getNode(String(result.id))
    if (!frame) throw new Error('the traced frame is not in the document')
    expect(graph.getNode(photo.id)).toBeUndefined()
    expect(graph.getNode(pageId)?.childIds).toEqual([frame.id])
    expect(frame).toMatchObject({ type: 'FRAME', name: 'Photo', x: 10, y: 20 })
    const colours = frame.childIds.map((id) => {
      const fill = graph.getNode(id)?.fills[0]
      return fill?.type === 'SOLID' ? [fill.color.r, fill.color.b].map((c) => Math.round(c)) : null
    })
    // White underneath, then the red disc and the blue bar.
    expect(colours).toContainEqual([1, 1])
    expect(colours).toContainEqual([1, 0])
    expect(colours).toContainEqual([0, 1])
  })

  test('traces the image where the layer shows it, filled or fitted into a box of its own shape', async () => {
    // Filled: scaled 2× to the width and cropped to the middle, the square at x 220–280, cut at y 130.
    for (const box of await tracedBoxes({}, 'FILL')) expect(box).toEqual([221, 100, 280, 130])
    // Fitted: 1×, centred across, the square at x 210–240, y 110–140.
    for (const box of await tracedBoxes({}, 'FIT')) expect(box).toEqual([210, 110, 240, 140])
  })

  test('keeps the shapes of a flipped image where the flip shows them', async () => {
    for (const box of await tracedBoxes({ flipX: true }, 'FIT'))
      expect(box).toEqual([160, 110, 190, 140])
  })

  test('refuses a layer that is not an image', async () => {
    const { graph, figma, pageId } = await setup()
    const box = graph.createNode('RECTANGLE', pageId, { name: 'Box' })
    expect(imageTrace.execute(figma, { id: box.id })).toEqual({
      error: 'Box is not an image layer'
    })
  })
})
