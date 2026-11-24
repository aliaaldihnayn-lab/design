import { expect, test, type Page } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'
import { testPath } from '#tests/helpers/paths'

async function importPlugin(page: Page, folder: string, name: string) {
  const chooser = page.waitForEvent('filechooser')
  await page.getByTestId('menubar-plugins').click()
  await page.getByRole('menuitem', { name: 'Import plugin from folder…' }).click()
  await (await chooser).setFiles(testPath(`fixtures/plugins/${folder}`))
  await expect(page.getByText(`${name} is installed`, { exact: true })).toBeVisible()
}

const pluginsMenu = (page: Page) => page.getByRole('menu', { name: 'Plugins' })

async function runCounter(page: Page) {
  await page.getByTestId('menubar-plugins').click()
  await pluginsMenu(page).getByRole('menuitem', { name: 'Run Counter' }).click()
}

const pageNames = (page: Page) =>
  page.evaluate(() => {
    const store = window.lawha?.getStore?.()
    if (!store) throw new Error('Lawha store not initialized')
    return store.graph.getChildren(store.state.currentPageId).map((node) => node.name)
  })

test('a nested menu command runs without a UI, closes with its message, and undoes as one step', async ({
  page
}) => {
  await page.goto('/?test')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  await canvas.clearCanvas()
  await importPlugin(page, 'rectangles', 'Rectangle Creator')

  await page.getByTestId('menubar-plugins').click()
  await page.getByRole('menuitem', { name: 'Rectangle Creator' }).click()
  await page.getByRole('menuitem', { name: 'Quick' }).click()
  await page.getByRole('menuitem', { name: 'Three Squares' }).click()

  await expect(page.getByText('Created 3 rectangles', { exact: true })).toBeVisible()
  await expect(page.getByTestId('plugin-window')).toHaveCount(0)
  await expect.poll(() => pageNames(page)).toEqual(['Rectangle 1', 'Rectangle 2', 'Rectangle 3'])

  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => pageNames(page)).toEqual([])
})

test('clientStorage outlives a run and a reload, the network follows the manifest, and removing the plugin forgets both', async ({
  page
}) => {
  await page.goto('/?test')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  await canvas.clearCanvas()
  await importPlugin(page, 'counter', 'Run Counter')

  await runCounter(page)
  await expect(page.getByText('Run 1, network blocked', { exact: true })).toBeVisible()
  await runCounter(page)
  await expect(page.getByText('Run 2, network blocked', { exact: true })).toBeVisible()

  // Installed plugins and their storage are kept on the device.
  await page.reload()
  await canvas.waitForInit()
  await runCounter(page)
  await expect(page.getByText('Run 3, network blocked', { exact: true })).toBeVisible()

  await page.getByTestId('menubar-plugins').click()
  await page.getByRole('menuitem', { name: 'Remove plugin' }).click()
  await page
    .getByRole('menu', { name: 'Remove plugin' })
    .getByRole('menuitem', { name: 'Run Counter' })
    .click()
  await expect(page.getByText('Run Counter was removed', { exact: true })).toBeVisible()
  await page.getByTestId('menubar-plugins').click()
  await expect(
    pluginsMenu(page).getByRole('menuitem', { name: 'Import plugin from folder…' })
  ).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Run Counter' })).toHaveCount(0)
  await page.keyboard.press('Escape')

  // Installed again, it starts from nothing.
  await importPlugin(page, 'counter', 'Run Counter')
  await runCounter(page)
  await expect(page.getByText('Run 1, network blocked', { exact: true })).toBeVisible()
})
