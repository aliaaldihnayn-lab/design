import { expect, test } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'
import { testPath } from '#tests/helpers/paths'

test('a Figma plugin imported from its folder opens its UI and edits the document', async ({
  page
}) => {
  await page.goto('/?test')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  await canvas.clearCanvas()

  const chooser = page.waitForEvent('filechooser')
  await page.getByTestId('menubar-plugins').click()
  await page.getByRole('menuitem', { name: 'Import plugin from folder…' }).click()
  await (await chooser).setFiles(testPath('fixtures/plugins/rectangles'))
  await expect(page.getByText('Rectangle Creator is installed', { exact: true })).toBeVisible()

  await page.getByTestId('menubar-plugins').click()
  await page.getByRole('menuitem', { name: 'Rectangle Creator' }).click()
  await page.getByRole('menuitem', { name: 'Create Rectangles…' }).click()

  const frame = page.frameLocator('[data-test-id="plugin-window-frame"]')
  await expect(page.getByTestId('plugin-window-title')).toHaveText('Rectangle Creator')
  await frame.locator('#count').fill('3')
  await frame.locator('#create').click()
  await expect(frame.locator('#status')).toHaveText('Created 3')

  const names = () =>
    page.evaluate(() => {
      const store = window.lawha?.getStore?.()
      if (!store) throw new Error('Lawha store not initialized')
      return store.graph.getChildren(store.state.currentPageId).map((node) => node.name)
    })
  expect(await names()).toEqual(['Rectangle 1', 'Rectangle 2', 'Rectangle 3'])

  await frame.locator('#cancel').click()
  await expect(page.getByTestId('plugin-window')).toBeHidden()

  // The plugin's turn is one undo step.
  await page.keyboard.press('ControlOrMeta+z')
  expect(await names()).toEqual([])
})
