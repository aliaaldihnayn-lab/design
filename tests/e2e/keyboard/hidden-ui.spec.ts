import { expect, test, useEditorSetup } from '#tests/e2e/fixtures'

const editor = useEditorSetup()

function showsUI() {
  return editor.page.evaluate(() => {
    const store = window.lawha?.getStore?.()
    if (!store) throw new Error('Lawha store not initialized')
    return store.state.showUI
  })
}

test('shortcuts keep working while the selection toolbar floats over the hidden UI', async () => {
  await editor.canvas.clearCanvas()
  await editor.canvas.drawRect(200, 200, 120, 80)
  await expect
    .poll(() => editor.page.evaluate(() => window.lawha?.getStore?.().state.selectedIds.size))
    .toBe(1)

  await editor.page.keyboard.press('ControlOrMeta+\\')
  await expect.poll(showsUI).toBe(false)
  await expect(editor.page.getByTestId('selection-toolbar')).toBeVisible()

  await editor.page.keyboard.press('ControlOrMeta+d')
  await expect
    .poll(() =>
      editor.page.evaluate(() => {
        const store = window.lawha?.getStore?.()
        if (!store) throw new Error('Lawha store not initialized')
        return store.graph.getChildren(store.state.currentPageId).length
      })
    )
    .toBe(2)

  await editor.page.keyboard.press('ControlOrMeta+\\')
  await expect.poll(showsUI).toBe(true)
  editor.canvas.assertNoErrors()
})
