import { afterEach, describe, expect, test } from 'bun:test'

import { createEditor } from '@lawha/core'
import { SkiaRenderer } from '@lawha/core/canvas'
import { FigmaAPI } from '@lawha/core/figma-api'
import { initCanvasKit } from '@lawha/core/io/formats/raster'
import { ALL_TOOLS } from '@lawha/core/tools'
import type { SceneNode } from '@lawha/scene-graph'
import { LAWHA_PLUGIN_DATA, readPluginData } from '@lawha/scene-graph/plugin-data'

const cleanups: (() => void)[] = []

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

async function createEditorWithRenderer() {
  const ck = await initCanvasKit()
  const surface = ck.MakeSurface(200, 200)
  if (!surface) throw new Error('Could not create CanvasKit surface')
  const renderer = new SkiaRenderer(ck, surface)
  const editor = createEditor()
  editor.setCanvasKit(ck, renderer)
  cleanups.push(() => {
    editor.dispose()
    renderer.destroy()
  })
  const figma = new FigmaAPI(editor.graph)
  figma.setRenderer(renderer)
  return { editor, figma }
}

const RED = { type: 'SOLID' as const, color: { r: 1, g: 0, b: 0, a: 1 }, opacity: 1, visible: true }

const box = (node: SceneNode | undefined) =>
  node ? [node.x, node.y, node.width, node.height].map((n) => Math.round(n)) : null

const effectOf = (node: SceneNode | undefined) =>
  node ? readPluginData(node.pluginData, LAWHA_PLUGIN_DATA.pathEffect) : undefined

async function meshedRectangle() {
  const context = await createEditorWithRenderer()
  const { editor, figma } = context
  const rect = editor.graph.createNode('RECTANGLE', editor.state.currentPageId, {
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    fills: [RED]
  })
  const def = ALL_TOOLS.find((t) => t.name === 'envelope_mesh')
  const result = await def?.execute(figma, { id: rect.id, rows: 2, columns: 2 })
  const id = (result as { created: { id: string }[] }).created[0].id
  editor.select([id])
  return { ...context, id }
}

describe('envelope mesh handles on the canvas', () => {
  test('the selected mesh shows its grid points and handles', async () => {
    const { editor, id } = await meshedRectangle()
    const handles = editor.liveEffectHandles()
    expect(handles?.kind).toBe('mesh')
    expect(handles?.kind === 'mesh' ? handles.points.length : 0).toBe(9)
    expect(editor.liveEffectHandleAt(100, 100)).toEqual({
      nodeId: id,
      hit: { kind: 'mesh-point', row: 2, column: 2 }
    })
  })

  test('handles show only for picked points; Shift adds and removes points', async () => {
    const { editor } = await meshedRectangle()
    const handleCount = () => {
      const shown = editor.liveEffectHandles()
      return shown?.kind === 'mesh' ? shown.handles.length : -1
    }
    expect(handleCount()).toBe(0)
    const press = (x: number, y: number, shift = false) => {
      const target = editor.liveEffectHandleAt(x, y)
      if (!target) throw new Error('no handle')
      editor.beginLiveEffectDrag(target.nodeId, target.hit, { shift })?.commit()
    }
    // The middle point has four handles, a corner two.
    press(50, 50)
    expect(handleCount()).toBe(4)
    press(0, 0, true)
    expect(handleCount()).toBe(6)
    press(50, 50, true)
    expect(handleCount()).toBe(2)
    press(100, 100)
    expect(handleCount()).toBe(2)
    expect(editor.state.meshPointSelection?.indices).toEqual([8])
  })

  test('dragging a point reshapes live, and one undo puts it back', async () => {
    const { editor, id } = await meshedRectangle()
    const target = editor.liveEffectHandleAt(100, 100)
    if (!target) throw new Error('no handle')
    const drag = editor.beginLiveEffectDrag(target.nodeId, target.hit)
    drag?.move(120, 110)
    drag?.move(140, 130)
    drag?.commit()
    expect(box(editor.graph.getNode(id))).toEqual([0, 0, 140, 130])
    editor.undoAction()
    expect(box(editor.graph.getNode(id))).toEqual([0, 0, 100, 100])
    editor.redoAction()
    expect(box(editor.graph.getNode(id))).toEqual([0, 0, 140, 130])
  })

  test('a cancelled drag leaves the mesh as it was', async () => {
    const { editor, id } = await meshedRectangle()
    const target = editor.liveEffectHandleAt(0, 0)
    if (!target) throw new Error('no handle')
    const drag = editor.beginLiveEffectDrag(target.nodeId, target.hit)
    drag?.move(-30, -30)
    drag?.cancel()
    expect(box(editor.graph.getNode(id))).toEqual([0, 0, 100, 100])
  })
})

describe('Width tool', () => {
  async function strokedLine() {
    const context = await createEditorWithRenderer()
    const line = context.editor.graph.createNode('VECTOR', context.editor.state.currentPageId, {
      x: 0,
      y: 50,
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

  test('a stroke becomes a live width profile, and a drag from its middle widens it there', async () => {
    const { editor, line } = await strokedLine()
    const id = editor.makeLiveWidth(line.id)
    if (!id) throw new Error('no width profile')
    editor.setTool('WIDTH')
    expect(editor.liveEffectHandles()?.kind).toBe('width')
    const target = editor.liveEffectHandleAt(100, 50)
    expect(target?.hit.kind).toBe('width-path')
    if (!target) return
    const drag = editor.beginLiveEffectDrag(target.nodeId, target.hit)
    drag?.move(100, 50 - 20)
    drag?.commit()
    const node = editor.graph.getNode(id)
    const effect = effectOf(node)
    expect(effect?.kind === 'width' ? effect.points.length : 0).toBe(3)
    // 20 px from the line is a 40 px wide stroke at the middle.
    expect(Math.round(node?.height ?? 0)).toBe(40)
    editor.undoAction()
    expect(Math.round(editor.graph.getNode(id)?.height ?? 0)).toBe(10)
  })

  test('Alt on a width point removes it', async () => {
    const { editor, line } = await strokedLine()
    const id = editor.makeLiveWidth(line.id)
    if (!id) throw new Error('no width profile')
    editor.setTool('WIDTH')
    const target = editor.liveEffectHandleAt(0, 55)
    expect(target?.hit).toMatchObject({ kind: 'width-point', index: 0 })
    if (!target) return
    expect(editor.beginLiveEffectDrag(target.nodeId, target.hit, { alt: true })).toBeNull()
    const effect = effectOf(editor.graph.getNode(id))
    expect(effect?.kind === 'width' ? effect.points : []).toEqual([{ t: 1, width: 1 }])
  })

  test('width points show on every contour, and a press on any of them takes the point', async () => {
    const { editor } = await createEditorWithRenderer()
    // Two separate lines in one vector, 100 px apart.
    const pair = editor.graph.createNode('VECTOR', editor.state.currentPageId, {
      x: 0,
      y: 0,
      width: 200,
      height: 100,
      vectorNetwork: {
        vertices: [
          { x: 0, y: 0 },
          { x: 200, y: 0 },
          { x: 0, y: 100 },
          { x: 200, y: 100 }
        ],
        segments: [
          { start: 0, end: 1, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
          { start: 2, end: 3, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } }
        ],
        regions: []
      },
      fills: [],
      strokes: [{ ...RED, weight: 10, align: 'CENTER' }],
      strokeWeight: 10
    })
    const id = editor.makeLiveWidth(pair.id)
    if (!id) throw new Error('no width profile')
    editor.setTool('WIDTH')
    const handles = editor.liveEffectHandles()
    expect(handles?.kind === 'width' ? handles.points.length : 0).toBe(4)
    expect(editor.liveEffectHandleAt(200, 105)?.hit).toMatchObject({
      kind: 'width-point',
      index: 1
    })
    expect(editor.liveEffectHandleAt(100, 100)?.hit.kind).toBe('width-path')
  })
})

describe('live blends', () => {
  test('moving an end makes the steps again between the ends as they are now', async () => {
    const { editor, figma } = await createEditorWithRenderer()
    const pageId = editor.state.currentPageId
    const from = editor.graph.createNode('ELLIPSE', pageId, {
      x: 0,
      y: 0,
      width: 20,
      height: 20,
      fills: [RED]
    })
    const to = editor.graph.createNode('ELLIPSE', pageId, {
      x: 180,
      y: 0,
      width: 20,
      height: 20,
      fills: [RED]
    })
    const def = ALL_TOOLS.find((t) => t.name === 'blend_shapes')
    const result = await def?.execute(figma, { from_id: from.id, to_id: to.id, steps: 1 })
    const groupId = (result as { id: string }).id
    const step = () => {
      const group = editor.graph.getNode(groupId)
      const blend = group && readPluginData(group.pluginData, LAWHA_PLUGIN_DATA.liveBlend)
      return blend ? editor.graph.getNode(blend.stepIds[0]) : undefined
    }
    const before = step()
    expect(Math.round(before?.y ?? -1)).toBe(0)
    editor.updateNode(to.id, { y: to.y + 100 })
    await Promise.resolve()
    // The one step sits halfway: 50 px down.
    expect(step()?.id).not.toBe(before?.id)
    expect(Math.round(step()?.y ?? -1) - Math.round(editor.graph.getNode(from.id)?.y ?? 0)).toBe(50)
  })
})
