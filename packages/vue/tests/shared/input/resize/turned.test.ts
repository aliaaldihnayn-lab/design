import { describe, expect, test } from 'bun:test'

import { createEditor, type Editor } from '@lawha/core'
import type { SceneNode } from '@lawha/scene-graph'
import { getWorldMatrix } from '@lawha/scene-graph/coordinate'
import Matrix from '@lawha/scene-graph/matrix'
import type { Vector } from '@lawha/scene-graph/primitives'

import { applyResize, commitResizePreview } from '#vue/shared/input/resize'
import type { DragResize } from '#vue/shared/input/types'

type Corner = 'nw' | 'ne' | 'se' | 'sw'

const OPPOSITE: Record<Corner, Corner> = { nw: 'se', ne: 'sw', se: 'nw', sw: 'ne' }

/** Where a corner of the layer, named in its own frame, is drawn on the canvas. */
function cornerOnCanvas(editor: Editor, node: SceneNode, corner: Corner): Vector {
  const x = corner.includes('e') ? node.width : 0
  const y = corner.includes('s') ? node.height : 0
  return Matrix.mapPoint(getWorldMatrix(node, editor.graph), { x, y })
}

function dragCorner(editor: Editor, node: SceneNode, handle: Corner, by: Vector) {
  const start = cornerOnCanvas(editor, node, handle)
  const drag: DragResize = {
    type: 'resize',
    handle,
    startX: start.x,
    startY: start.y,
    origRect: { x: node.x, y: node.y, width: node.width, height: node.height },
    nodeId: node.id,
    origVectorNetwork: null,
    origFillGeometry: [],
    origStrokeGeometry: [],
    origDerivedTextGlyphs: null,
    origStrokes: [],
    origTextPathData: null,
    origTextPathBox: null,
    lockedAspectRatio: null,
    origChildren: null
  }
  applyResize(drag, start.x + by.x, start.y + by.y, false, editor)
  commitResizePreview(drag, editor)
  return { x: start.x + by.x, y: start.y + by.y }
}

const CASES: Array<{
  name: string
  layer: Partial<SceneNode>
  parent?: Partial<SceneNode>
  handle: Corner
}> = [
  { name: 'a turned layer', layer: { rotation: 37 }, handle: 'se' },
  { name: 'a turned layer from its top-left corner', layer: { rotation: 37 }, handle: 'nw' },
  { name: 'a layer turned past a quarter', layer: { rotation: -120 }, handle: 'ne' },
  { name: 'a reflected, turned layer', layer: { rotation: 37, flipX: true }, handle: 'se' },
  { name: 'a reflected layer', layer: { flipY: true }, handle: 'sw' },
  { name: 'a layer in a turned frame', layer: {}, parent: { rotation: 25 }, handle: 'se' }
]

describe('resizing a turned or reflected layer from a corner', () => {
  for (const { name, layer, parent, handle } of CASES) {
    test(`${name} keeps the opposite corner and puts the dragged one under the pointer`, () => {
      const editor = createEditor()
      try {
        const pageId = editor.state.currentPageId
        const parentId = parent
          ? editor.graph.createNode('FRAME', pageId, {
              x: 50,
              y: 40,
              width: 500,
              height: 400,
              ...parent
            }).id
          : pageId
        const node = editor.graph.createNode('RECTANGLE', parentId, {
          x: 120,
          y: 90,
          width: 200,
          height: 100,
          ...layer
        })
        const anchor = cornerOnCanvas(editor, node, OPPOSITE[handle])
        const pointer = dragCorner(editor, node, handle, { x: 23, y: 17 })

        const resized = editor.graph.getNode(node.id)
        if (!resized) throw new Error('resized layer missing')
        const kept = cornerOnCanvas(editor, resized, OPPOSITE[handle])
        const dragged = cornerOnCanvas(editor, resized, handle)
        expect(kept.x).toBeCloseTo(anchor.x, 6)
        expect(kept.y).toBeCloseTo(anchor.y, 6)
        expect(dragged.x).toBeCloseTo(pointer.x, 6)
        expect(dragged.y).toBeCloseTo(pointer.y, 6)
        expect(resized.rotation).toBe(layer.rotation ?? 0)

        editor.undoAction()
        expect(editor.graph.getNode(node.id)).toMatchObject({
          x: 120,
          y: 90,
          width: 200,
          height: 100
        })
      } finally {
        editor.dispose()
      }
    })
  }
})
