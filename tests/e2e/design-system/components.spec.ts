import { expect, test } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'

test('component sets are added to the page on demand, without building the system', async ({
  page
}) => {
  await page.goto('/?test')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  await canvas.clearCanvas()

  await page
    .getByTestId('design-system-section')
    .getByRole('button', { name: 'Add component sets' })
    .click()

  const sets = () =>
    page.evaluate(() => {
      const store = window.lawha?.getStore?.()
      if (!store) throw new Error('Lawha store not initialized')
      return store.graph
        .getChildren(store.state.currentPageId)
        .filter((node) => node.type === 'COMPONENT_SET')
        .map((node) => [node.name, node.childIds.length])
    })
  await expect.poll(sets).toEqual([
    ['Button', 9],
    ['Input', 4],
    ['Badge', 3]
  ])

  // One undo step takes them all away again.
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(sets).toEqual([])
})
