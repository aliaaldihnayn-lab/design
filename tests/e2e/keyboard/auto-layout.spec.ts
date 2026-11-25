import { expect, test, useEditorSetup } from '#tests/e2e/fixtures'
import { openAppMenu } from '#tests/helpers/menu'

const editor = useEditorSetup()

test.describe('auto-layout shortcut', () => {
  function selectedLayout() {
    return editor.page.evaluate(() => {
      const store = window.lawha?.getStore?.()
      if (!store) throw new Error('Lawha store not initialized')
      const [id] = store.state.selectedIds
      const node = id ? store.graph.getNode(id) : undefined
      const parent = node?.parentId ? store.graph.getNode(node.parentId) : undefined
      return {
        id,
        layoutMode: node?.layoutMode,
        children: node?.childIds.length ?? 0,
        parentLayoutMode: parent?.type === 'FRAME' ? parent.layoutMode : null
      }
    })
  }

  test('⇧A adds auto layout to a frame, wraps it once it has one, and ⌥⇧A removes it', async () => {
    await editor.canvas.clearCanvas()
    await editor.canvas.drawRect(100, 100, 200, 200)
    await editor.canvas.selectAll()

    // Change to frame type for auto-layout
    await editor.page.evaluate(() => {
      const store = window.lawha?.getStore?.()
      if (!store) throw new Error('Lawha store not initialized')
      const nodes = [...store.state.selectedIds]
      if (nodes[0]) store.updateNode(nodes[0], { type: 'FRAME' })
    })
    await editor.canvas.waitForRender()
    const frame = await selectedLayout()
    expect(frame.layoutMode).toBe('NONE')

    await editor.page.keyboard.press('Shift+a')
    await editor.canvas.waitForRender()
    expect(await selectedLayout()).toMatchObject({ id: frame.id, layoutMode: 'VERTICAL' })

    await editor.page.keyboard.press('Shift+a')
    await editor.canvas.waitForRender()
    const wrapper = await selectedLayout()
    expect(wrapper.id).not.toBe(frame.id)
    expect(wrapper).toMatchObject({ layoutMode: 'VERTICAL', children: 1 })

    await editor.page.keyboard.press('Alt+Shift+a')
    await editor.canvas.waitForRender()
    expect(await selectedLayout()).toMatchObject({ id: wrapper.id, layoutMode: 'NONE' })

    await editor.page.keyboard.press('ControlOrMeta+z')
    await editor.canvas.waitForRender()
    expect(await selectedLayout()).toMatchObject({ id: wrapper.id, layoutMode: 'VERTICAL' })
  })

  test('⇧A from the Arrange menu does what the key does', async () => {
    await editor.canvas.clearCanvas()
    const id = await editor.page.evaluate(() => {
      const store = window.lawha?.getStore?.()
      if (!store) throw new Error('Lawha store not initialized')
      const node = store.graph.createNode('FRAME', store.state.currentPageId, {
        x: 100,
        y: 100,
        width: 120,
        height: 80
      })
      store.select([node.id])
      return node.id
    })
    await editor.canvas.waitForRender()
    const arrange = await openAppMenu(editor.page, 'Arrange')
    await arrange.getByRole('menuitem', { name: /auto layout/i }).click()
    await editor.canvas.waitForRender()
    expect(await selectedLayout()).toMatchObject({ id, layoutMode: 'VERTICAL' })
  })
})
