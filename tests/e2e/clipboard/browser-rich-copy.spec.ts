import { expect, test, useEditorSetup } from '#tests/e2e/fixtures'
import { openAppMenu } from '#tests/helpers/menu'

const editor = useEditorSetup('/?test')

test.beforeAll(async () => {
  await editor.page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
})

test('browser menu copy writes rich and plain Lawha clipboard formats', async () => {
  await editor.canvas.clearCanvas()
  await editor.canvas.drawRect(100, 100, 120, 80)
  await editor.canvas.waitForRender()

  const copyMenu = await openAppMenu(editor.page, 'Edit')
  await copyMenu.getByRole('menuitem', { name: /^Copy/ }).click()

  // Copy writes once the document is encoded; until then the clipboard is empty, and a read that
  // overlaps the write fails because the data changed under it.
  const readClipboard = () =>
    editor.page.evaluate(async () => {
      try {
        const [item] = await navigator.clipboard.read()
        if (!item) return { types: [], html: '', plainText: '' }
        const html = item.types.includes('text/html')
          ? await (await item.getType('text/html')).text()
          : ''
        const plainText = item.types.includes('text/plain')
          ? await (await item.getType('text/plain')).text()
          : ''
        return { types: item.types, html, plainText }
      } catch {
        return { types: [], html: '', plainText: '' }
      }
    })
  await expect.poll(async () => (await readClipboard()).types).toContain('text/html')
  const clipboard = await readClipboard()

  expect(clipboard.types).toContain('text/html')
  expect(clipboard.types).toContain('text/plain')
  expect(clipboard.html).toContain('data-buffer="&lt;!--(figma)')
  expect(clipboard.plainText).not.toBe('')

  const before = await editor.page.evaluate(() => {
    const store = window.lawha?.getStore?.()
    if (!store) throw new Error('Lawha store not initialized')
    return store.graph.getChildren(store.state.currentPageId).length
  })
  const pasteMenu = await openAppMenu(editor.page, 'Edit')
  await pasteMenu.getByRole('menuitem', { name: /^Paste\s+(?:⌘|Ctrl)/ }).click()
  await expect
    .poll(() =>
      editor.page.evaluate(() => {
        const store = window.lawha?.getStore?.()
        if (!store) throw new Error('Lawha store not initialized')
        return store.graph.getChildren(store.state.currentPageId).length
      })
    )
    .toBe(before + 1)
})

test('text copied in another app after a copy here pastes as a text layer, not the old layers', async () => {
  await editor.canvas.clearCanvas()
  await editor.page.evaluate(() => {
    const store = window.lawha?.getStore?.()
    if (!store) throw new Error('Lawha store not initialized')
    const id = store.createShape('TEXT', 100, 100, 10, 10)
    store.updateNodeWithUndo(id, { text: 'مرحبا بالعالم', textAutoResize: 'WIDTH_AND_HEIGHT' })
    store.select([id])
  })
  await editor.page.evaluate(() => navigator.clipboard.writeText(''))
  await editor.page.keyboard.press('ControlOrMeta+c')
  // Another app copies a line of text over the copy made here.
  const copiedText = await editor.page.evaluate(async () => {
    let read = ''
    for (let attempt = 0; attempt < 50 && !read; attempt++) {
      await new Promise((resolve) => {
        setTimeout(resolve, 50)
      })
      read = await navigator.clipboard.readText().catch(() => '')
    }
    await navigator.clipboard.writeText('نص من تطبيق آخر 42')
    return read
  })
  // Another app gets the text layer's words, not its name.
  expect(copiedText).toBe('مرحبا بالعالم')

  await editor.page.evaluate(() => window.lawha?.getStore?.()?.clearSelection())
  await editor.page.keyboard.press('ControlOrMeta+v')
  const layers = () =>
    editor.page.evaluate(() => {
      const store = window.lawha?.getStore?.()
      if (!store) throw new Error('Lawha store not initialized')
      return store.graph.getChildren(store.state.currentPageId).map((node) => ({
        type: node.type,
        text: node.text,
        selected: store.state.selectedIds.has(node.id),
        sized: node.width > 1 && node.height > 1
      }))
    })
  await expect.poll(layers).toEqual([
    { type: 'TEXT', text: 'مرحبا بالعالم', selected: false, sized: true },
    { type: 'TEXT', text: 'نص من تطبيق آخر 42', selected: true, sized: true }
  ])

  await editor.canvas.undo()
  await expect.poll(async () => (await layers()).length).toBe(1)
})
