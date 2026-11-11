import { expect, test, useEditorSetupWithClear } from '#tests/e2e/fixtures'

// The Publication tab's Pages panel: pages listed in reading order, added, reordered by dragging,
// numbered in Arabic-Indic digits, and read right to left.

const editor = useEditorSetupWithClear('/?test')

function pageNames() {
  return editor.page
    .getByTestId('publication-page-row')
    .evaluateAll((rows) =>
      rows.map((row) => row.querySelector('button span + span')?.textContent?.trim())
    )
}

test('lists, adds, reorders and numbers the pages of a publication', async () => {
  await editor.page.evaluate(() => {
    const store = window.lawha?.getStore?.()
    if (!store) throw new Error('Lawha store not initialized')
    for (const [index, x] of [0, 400, 800].entries()) {
      store.graph.createNode('FRAME', store.state.currentPageId, {
        name: `Chapter ${index + 1}`,
        x,
        y: 0,
        width: 300,
        height: 400
      })
    }
    store.requestRender()
  })
  await editor.page.getByTestId('left-panel-publication-tab').click()
  const rows = editor.page.getByTestId('publication-page-row')
  await expect(rows).toHaveCount(3)
  expect(await pageNames()).toEqual(['Chapter 1', 'Chapter 2', 'Chapter 3'])

  await editor.page.getByTestId('publication-add-page').click()
  await expect(rows).toHaveCount(4)

  // Drag the third page above the first.
  await rows.nth(2).dragTo(rows.nth(0), { targetPosition: { x: 20, y: 2 } })
  await expect.poll(pageNames).toEqual(['Chapter 3', 'Chapter 1', 'Chapter 2', 'Page 4'])

  await editor.page.getByTestId('publication-number-format').click()
  await editor.page.getByRole('option', { name: /Arabic-Indic/ }).click()
  await expect(editor.page.getByTestId('publication-page-number')).toHaveText(['١', '٢', '٣', '٤'])

  // Right to left: the first page keeps its place and the rest run to its left.
  const xs = () =>
    editor.page.evaluate(() => {
      const store = window.lawha?.getStore?.()
      return store?.publicationPageList().map((page) => store.graph.getNode(page.id)?.x ?? 0) ?? []
    })
  const before = await xs()
  await editor.page.getByTestId('publication-direction').getByText('Right to left').click()
  await expect.poll(pageNames).toEqual(['Chapter 3', 'Chapter 1', 'Chapter 2', 'Page 4'])
  const after = await xs()
  expect(after[0]).toBe(before[0])
  expect(after[1]).toBeLessThan(after[0])
  expect(after[3]).toBeLessThan(after[2])
  editor.canvas.assertNoErrors()
})
