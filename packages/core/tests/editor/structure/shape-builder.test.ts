import { afterEach, describe, expect, test } from 'bun:test'

import { createEditor } from '@lawha/core'
import { SkiaRenderer } from '@lawha/core/canvas'
import { initCanvasKit } from '@lawha/core/io/formats/raster'
import type { SceneNode } from '@lawha/scene-graph'
import type { Color } from '@lawha/scene-graph/primitives'

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
  return editor
}

const RED: Color = { r: 1, g: 0, b: 0, a: 1 }
const BLUE: Color = { r: 0, g: 0, b: 1, a: 1 }
const solid = (color: Color) => ({ type: 'SOLID' as const, color, opacity: 1, visible: true })

type TestEditor = Awaited<ReturnType<typeof createEditorWithRenderer>>

/** Two 100 px squares overlapping by half: three regions, red alone, both, and blue alone. */
function twoSquares(editor: TestEditor) {
  const pageId = editor.state.currentPageId
  const red = editor.graph.createNode('RECTANGLE', pageId, {
    name: 'Red',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    fills: [solid(RED)]
  })
  const blue = editor.graph.createNode('RECTANGLE', pageId, {
    name: 'Blue',
    x: 50,
    y: 0,
    width: 100,
    height: 100,
    fills: [solid(BLUE)]
  })
  editor.select([red.id, blue.id])
  return { pageId, red, blue }
}

function layers(editor: TestEditor, pageId: string) {
  return (editor.graph.getNode(pageId)?.childIds ?? [])
    .map((id) => editor.graph.getNode(id))
    .filter((node): node is SceneNode => node !== undefined)
    .map((node) => ({
      name: node.name,
      type: node.type,
      box: [node.x, node.y, node.width, node.height].map((n) => Math.round(n)),
      fill: node.fills[0]?.type === 'SOLID' ? node.fills[0].color : null
    }))
}

describe('shapeBuilderSelected', () => {
  test('merges the regions a drag crosses into one shape painted like the first', async () => {
    const editor = await createEditorWithRenderer()
    const { pageId } = twoSquares(editor)
    const made = editor.shapeBuilderSelected([
      { x: 25, y: 50 },
      { x: 75, y: 50 }
    ])
    expect(made).toHaveLength(2)
    expect(layers(editor, pageId)).toEqual([
      { name: 'Blue', type: 'VECTOR', box: [100, 0, 50, 100], fill: BLUE },
      { name: 'Red', type: 'VECTOR', box: [0, 0, 100, 100], fill: RED }
    ])
    expect(new Set(editor.state.selectedIds)).toEqual(new Set(made))
  })

  test('deletes the region under the pointer from every shape over it', async () => {
    const editor = await createEditorWithRenderer()
    const { pageId } = twoSquares(editor)
    editor.shapeBuilderSelected([{ x: 75, y: 50 }], 'delete')
    expect(layers(editor, pageId)).toEqual([
      { name: 'Red', type: 'VECTOR', box: [0, 0, 50, 100], fill: RED },
      { name: 'Blue', type: 'VECTOR', box: [100, 0, 50, 100], fill: BLUE }
    ])
  })

  test('undo puts the shapes back and redo cuts them again', async () => {
    const editor = await createEditorWithRenderer()
    const { pageId, red, blue } = twoSquares(editor)
    const before = layers(editor, pageId)
    editor.shapeBuilderSelected([{ x: 75, y: 50 }], 'delete')
    const after = layers(editor, pageId)
    editor.undo.undo()
    expect(layers(editor, pageId)).toEqual(before)
    expect(editor.graph.getNode(red.id)?.type).toBe('RECTANGLE')
    expect(editor.graph.getNode(blue.id)?.type).toBe('RECTANGLE')
    editor.undo.redo()
    expect(layers(editor, pageId)).toEqual(after)
  })

  test('does nothing outside every region', async () => {
    const editor = await createEditorWithRenderer()
    const { pageId } = twoSquares(editor)
    const before = layers(editor, pageId)
    expect(editor.shapeBuilderSelected([{ x: 300, y: 300 }])).toBeNull()
    expect(layers(editor, pageId)).toEqual(before)
  })

  test('highlights the region under the pointer and clears it', async () => {
    const editor = await createEditorWithRenderer()
    twoSquares(editor)
    editor.setShapeBuilderHover([{ x: 75, y: 50 }])
    expect(editor.state.shapeBuilderHover?.paths).toHaveLength(1)
    editor.setShapeBuilderHover(null)
    expect(editor.state.shapeBuilderHover).toBeNull()
  })

  test('a shape inside a hole of another is a region of its own', async () => {
    const editor = await createEditorWithRenderer()
    const pageId = editor.state.currentPageId
    const ring = editor.graph.createNode('ELLIPSE', pageId, {
      name: 'Ring',
      x: 0,
      y: 0,
      width: 120,
      height: 120,
      fills: [solid(RED)],
      arcData: { startingAngle: 0, endingAngle: 2 * Math.PI, innerRadius: 0.5 }
    })
    const dot = editor.graph.createNode('ELLIPSE', pageId, {
      name: 'Dot',
      x: 50,
      y: 50,
      width: 20,
      height: 20,
      fills: [solid(BLUE)]
    })
    editor.select([ring.id, dot.id])
    editor.shapeBuilderSelected([{ x: 60, y: 60 }], 'delete')
    expect(layers(editor, pageId).map(({ name }) => name)).toEqual(['Ring'])
    expect(editor.graph.getNode(ring.id)).toBeDefined()
  })
})
