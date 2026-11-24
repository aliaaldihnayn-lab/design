import { describe, expect, test } from 'bun:test'

import { createEditor, type Editor } from '@lawha/core'
import type { TextAutoResize } from '@lawha/scene-graph'
import type { Rect } from '@lawha/scene-graph/primitives'

import { applyResize, cancelResizePreview, commitResizePreview } from '#vue/shared/input/resize'
import type { DragResize } from '#vue/shared/input/types'

const LONG = 'هذا نص عربي طويل يجب أن يلتف داخل الصندوق ولا يخرج من حدوده'

function textLayer(textAutoResize: TextAutoResize) {
  const editor = createEditor()
  editor.state.snappingPreferences = { geometry: false, objects: false, pixelGrid: false }
  const id = editor.createShape('TEXT', 100, 100, 600, 30)
  editor.updateNodeWithUndo(id, { text: LONG, fontSize: 20, textAutoResize })
  editor.select([id])
  const node = editor.graph.getNode(id)
  if (!node) throw new Error('missing text layer')
  return { editor, id, rect: { x: node.x, y: node.y, width: node.width, height: node.height } }
}

function drag(id: string, handle: DragResize['handle'], rect: Rect): DragResize {
  return {
    type: 'resize',
    handle,
    startX: handle.includes('e') ? rect.x + rect.width : rect.x + rect.width / 2,
    startY: handle.includes('s') ? rect.y + rect.height : rect.y + rect.height / 2,
    origRect: { ...rect },
    nodeId: id,
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
}

function layer(editor: Editor, id: string) {
  const node = editor.graph.getNode(id)
  if (!node) throw new Error('missing text layer')
  return node
}

// Figma: dragging an auto-width text layer's side makes it wrap at that width and keep sizing its
// height; dragging the height of text that sizes it fixes the box.
describe('resizing text from a handle', () => {
  test('a narrowed auto-width layer wraps and grows down, and undo puts it back', () => {
    const { editor, id, rect } = textLayer('WIDTH_AND_HEIGHT')
    const resize = drag(id, 'e', rect)
    applyResize(resize, resize.startX - rect.width + 200, resize.startY, false, editor)
    expect(layer(editor, id)).toMatchObject({ textAutoResize: 'HEIGHT', width: 200 })
    expect(layer(editor, id).height).toBeGreaterThan(rect.height * 2)
    commitResizePreview(resize, editor)
    expect(layer(editor, id)).toMatchObject({ textAutoResize: 'HEIGHT', width: 200 })
    expect(layer(editor, id).height).toBeGreaterThan(rect.height * 2)

    editor.undoAction()
    expect(layer(editor, id)).toMatchObject({ textAutoResize: 'WIDTH_AND_HEIGHT', ...rect })
    editor.redoAction()
    expect(layer(editor, id)).toMatchObject({ textAutoResize: 'HEIGHT', width: 200 })
    editor.dispose()
  })

  for (const mode of ['WIDTH_AND_HEIGHT', 'HEIGHT'] as const) {
    test(`dragging the height of ${mode} text fixes its box`, () => {
      const { editor, id, rect } = textLayer(mode)
      const resize = drag(id, 's', rect)
      applyResize(resize, resize.startX, resize.startY + 40, false, editor)
      commitResizePreview(resize, editor)
      expect(layer(editor, id)).toMatchObject({
        textAutoResize: 'NONE',
        height: rect.height + 40
      })
      editor.undoAction()
      expect(layer(editor, id)).toMatchObject({ textAutoResize: mode, ...rect })
      editor.dispose()
    })
  }

  test('a cancelled drag leaves the text sizing itself', () => {
    const { editor, id, rect } = textLayer('WIDTH_AND_HEIGHT')
    const resize = drag(id, 'e', rect)
    applyResize(resize, resize.startX - 300, resize.startY, false, editor)
    cancelResizePreview(resize, editor)
    expect(layer(editor, id)).toMatchObject({ textAutoResize: 'WIDTH_AND_HEIGHT', ...rect })
    editor.dispose()
  })

  test('a fixed box stays fixed', () => {
    const { editor, id, rect } = textLayer('NONE')
    const resize = drag(id, 'e', rect)
    applyResize(resize, resize.startX - 100, resize.startY, false, editor)
    commitResizePreview(resize, editor)
    expect(layer(editor, id)).toMatchObject({ textAutoResize: 'NONE', width: rect.width - 100 })
    editor.dispose()
  })
})
