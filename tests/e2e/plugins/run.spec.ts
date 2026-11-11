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

test('two plugins run at the same time, each with its own window and state', async ({ page }) => {
  await page.goto('/?test')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  await canvas.clearCanvas()

  for (const [folder, name] of [
    ['rectangles', 'Rectangle Creator'],
    ['ellipses', 'Ellipse Maker']
  ]) {
    const chooser = page.waitForEvent('filechooser')
    await page.getByTestId('menubar-plugins').click()
    await page.getByRole('menuitem', { name: 'Import plugin from folder…' }).click()
    await (await chooser).setFiles(testPath(`fixtures/plugins/${folder}`))
    await expect(page.getByText(`${name} is installed`, { exact: true })).toBeVisible()
  }

  await page.getByTestId('menubar-plugins').click()
  await page.getByRole('menuitem', { name: 'Rectangle Creator' }).click()
  await page.getByRole('menuitem', { name: 'Create Rectangles…' }).click()
  await page.getByTestId('menubar-plugins').click()
  await page.getByRole('menuitem', { name: 'Ellipse Maker' }).click()

  const windows = page.getByTestId('plugin-window')
  await expect(windows).toHaveCount(2)
  const rectangles = page.frameLocator('[data-plugin-id="lawha-sample-rectangles"] iframe')
  const ellipses = page.frameLocator('[data-plugin-id="lawha-sample-ellipses"] iframe')

  await ellipses.locator('#ellipse').click()
  await expect(ellipses.locator('#status')).toHaveText('Made 1')
  await rectangles.locator('#count').fill('2')
  await rectangles.locator('#create').click()
  await expect(rectangles.locator('#status')).toHaveText('Created 2')
  await ellipses.locator('#ellipse').click()
  await expect(ellipses.locator('#status')).toHaveText('Made 2')
  // The rectangle plugin's window heard nothing the ellipse plugin sent.
  await expect(rectangles.locator('#status')).toHaveText('Created 2')

  const names = () =>
    page.evaluate(() => {
      const store = window.lawha?.getStore?.()
      if (!store) throw new Error('Lawha store not initialized')
      return store.graph.getChildren(store.state.currentPageId).map((node) => node.name)
    })
  expect((await names()).toSorted()).toEqual([
    'Ellipse 1',
    'Ellipse 2',
    'Rectangle 1',
    'Rectangle 2'
  ])

  // Closing one plugin leaves the other running.
  await page
    .locator('[data-plugin-id="lawha-sample-rectangles"]')
    .getByTestId('plugin-window-close')
    .click()
  await expect(windows).toHaveCount(1)
  await ellipses.locator('#ellipse').click()
  await expect(ellipses.locator('#status')).toHaveText('Made 3')
})
