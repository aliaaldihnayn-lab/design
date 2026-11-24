import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test'

import type { CanvasKit, Surface } from 'canvaskit-wasm'

import { SkiaRenderer } from '@lawha/core/canvas'
import { FigmaAPI } from '@lawha/core/figma-api'
import { initCanvasKit } from '@lawha/core/io/formats/raster'
import { SceneGraph } from '@lawha/scene-graph'

let ck: CanvasKit
const surfaces: Surface[] = []

beforeAll(async () => {
  ck = await initCanvasKit()
})

afterAll(() => {
  for (const surface of surfaces) surface.delete()
})

/** A renderer that records which boolean results it is told to drop. */
function recordingRenderer() {
  const surface = ck.MakeSurface(16, 16)
  if (!surface) throw new Error('Could not create CanvasKit surface')
  surfaces.push(surface)
  const renderer = new SkiaRenderer(ck, surface)
  const dropped: string[] = []
  spyOn(renderer, 'invalidateVectorPath').mockImplementation((id: string) => {
    dropped.push(id)
  })
  return { renderer, dropped }
}

/** A boolean operation with one rectangle in it, and an edit that lands inside it. */
function booleanWithEdit(graph: SceneGraph): { booleanId: string; edit: () => void } {
  const page = graph.getPages()[0]
  const boolean = graph.createNode('BOOLEAN_OPERATION', page.id, { name: 'Union' })
  const rect = graph.createNode('RECTANGLE', boolean.id, { width: 10, height: 10 })
  return { booleanId: boolean.id, edit: () => graph.updateNode(rect.id, { width: 20 }) }
}

describe('the Figma API and its renderer', () => {
  test('a renderer of its own is told when an edit lands inside a boolean operation', () => {
    const graph = new SceneGraph()
    const { renderer, dropped } = recordingRenderer()
    const { booleanId, edit } = booleanWithEdit(graph)
    new FigmaAPI(graph).setRenderer(renderer)
    edit()
    expect(dropped).toContain(booleanId)
  })

  test('an editor’s renderer is left to the editor, so a short-lived API leaves the graph as it was', () => {
    const graph = new SceneGraph()
    const { renderer, dropped } = recordingRenderer()
    const { edit } = booleanWithEdit(graph)
    // One API per tool run, as the app makes them: none of them may outlive its run by
    // listening to the graph, which would keep the renderer and its canvas for the graph's life.
    for (let run = 0; run < 3; run++)
      new FigmaAPI(graph).setRenderer(renderer, { ownerInvalidates: true })
    edit()
    expect(dropped).toEqual([])
  })

  test('replacing or clearing the renderer stops telling the old one', () => {
    const graph = new SceneGraph()
    const first = recordingRenderer()
    const { edit } = booleanWithEdit(graph)
    const api = new FigmaAPI(graph)
    api.setRenderer(first.renderer)
    api.setRenderer(null)
    edit()
    expect(first.dropped).toEqual([])
  })
})
