import { afterEach, describe, expect, test } from 'bun:test'

import { createEditor, type Editor } from '@lawha/core/editor'

let editor: Editor

afterEach(() => editor.dispose())

function editorCountingRenders() {
  editor = createEditor()
  let renders = 0
  editor.onEditorEvent('render:requested', () => {
    renders++
  })
  return { editor, renders: () => renders }
}

const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe('renders during an async mutation', () => {
  test('changes made across awaits ask for one render, when the mutation ends', async () => {
    const { editor, renders } = editorCountingRenders()
    const page = editor.state.currentPageId
    const versions: number[] = []
    await editor.runMutationWithLayout(async () => {
      for (let i = 0; i < 20; i++) {
        editor.graph.createNode('RECTANGLE', page, { name: `R${i}`, width: 10, height: 10 })
        versions.push(editor.state.sceneVersion)
        await pause()
      }
    }, page)
    // The interface saw none of the twenty changes one by one, and sees them all now.
    expect(new Set(versions).size).toBe(1)
    expect(renders()).toBe(1)
    expect(editor.state.sceneVersion).toBeGreaterThan(versions[0])
    expect(editor.graph.getChildren(page)).toHaveLength(20)
  })

  test('a mutation that fails still renders what it changed', async () => {
    const { editor, renders } = editorCountingRenders()
    const page = editor.state.currentPageId
    const failing = editor.runMutationWithLayout(async () => {
      editor.graph.createNode('RECTANGLE', page, { width: 10, height: 10 })
      await pause()
      throw new Error('stopped')
    }, page)
    await expect(failing).rejects.toThrow('stopped')
    expect(renders()).toBe(1)
  })

  test('changes outside a mutation still render at once', () => {
    const { editor, renders } = editorCountingRenders()
    editor.graph.createNode('RECTANGLE', editor.state.currentPageId, { width: 10, height: 10 })
    expect(renders()).toBe(1)
  })
})
