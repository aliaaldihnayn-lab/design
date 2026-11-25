import { readFile } from 'node:fs/promises'

import { expect, test } from '#tests/e2e/fixtures'
import { CanvasHelper } from '#tests/helpers/canvas'

test.beforeEach(async ({ page }) => {
  await page.goto('/?test')
  await new CanvasHelper(page).waitForInit()
  await page.evaluate(() => {
    const store = window.lawha?.getStore?.()
    if (!store) throw new Error('Editor unavailable')
    store.createShape('RECTANGLE', 100, 100, 100, 100)
  })
  await expect(
    page.getByRole('tab').filter({ has: page.getByRole('img', { name: 'Unsaved changes' }) })
  ).toBeVisible()
})

test('Cancel retains the dirty document and recovery does not mark it saved', async ({ page }) => {
  await page.evaluate(async () => {
    await window.lawha?.getStore?.().persistRecoveryNow()
  })
  await page.getByTestId('tabbar-close').click()
  const dialog = page.getByRole('alertdialog', { name: /Save changes to/ })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeFocused()
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await expect(page.getByRole('img', { name: 'Unsaved changes' })).toBeVisible()
  expect(await page.evaluate(() => window.lawha?.getStore?.().hasUnsavedChanges())).toBe(true)
})

test('Don’t Save closes the document', async ({ page }) => {
  await page.getByTestId('tabbar-close').click()
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Don’t Save', exact: true })
    .click()
  await expect(page.getByTestId('recent-files-home')).toBeVisible()
  await expect(page.getByRole('img', { name: 'Unsaved changes' })).not.toBeVisible()
})

test('cancelling the Save file picker keeps the dirty document open', async ({ page }) => {
  const picker = await page.evaluateHandle(() => {
    const original = window.showSaveFilePicker
    const state = {
      calls: 0,
      restore: () => {
        window.showSaveFilePicker = original
      }
    }
    window.showSaveFilePicker = async () => {
      state.calls++
      throw new DOMException('Cancelled', 'AbortError')
    }
    return state
  })
  try {
    await page.getByTestId('tabbar-close').click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Save', exact: true }).click()
    await expect.poll(() => picker.evaluate((state) => state.calls)).toBe(1)
    await expect(page.getByRole('alertdialog')).not.toBeVisible()
    await expect(page.getByRole('img', { name: 'Unsaved changes' })).toBeVisible()
  } finally {
    await picker.evaluate((handle) => handle.restore())
    await picker.dispose()
  }
})

test('Save downloads the document before closing when the file API is unavailable', async ({
  page
}) => {
  const picker = await page.evaluateHandle(() => {
    const original = window.showSaveFilePicker
    window.showSaveFilePicker = undefined
    return {
      restore: () => {
        window.showSaveFilePicker = original
      }
    }
  })
  try {
    await page.getByTestId('tabbar-close').click()
    page.once('dialog', (dialog) => dialog.accept('Saved-before-close.fig'))
    const download = page.waitForEvent('download')
    await page.getByRole('alertdialog').getByRole('button', { name: 'Save', exact: true }).click()
    expect((await download).suggestedFilename()).toBe('Saved-before-close.fig')
    await expect(page.getByTestId('recent-files-home')).toBeVisible()
  } finally {
    await picker.evaluate((handle) => handle.restore())
    await picker.dispose()
  }
})

test('Ctrl/Cmd+S downloads a .fig that opens again when the file API is unavailable', async ({
  page
}) => {
  const picker = await page.evaluateHandle(() => {
    const original = window.showSaveFilePicker
    window.showSaveFilePicker = undefined
    return {
      restore: () => {
        window.showSaveFilePicker = original
      }
    }
  })
  try {
    page.once('dialog', (dialog) => dialog.accept('Shortcut save.fig'))
    const download = page.waitForEvent('download')
    await page.keyboard.press('ControlOrMeta+s')
    const file = await download
    expect(file.suggestedFilename()).toBe('Shortcut save.fig')
    await expect(page.getByRole('img', { name: 'Unsaved changes' })).toHaveCount(0)

    const path = await file.path()
    await page.getByTestId('tabbar-new').click()
    // Saved, so it closes without asking; the same file opened again would only show this tab.
    await page.locator('[data-slot="tab-item"]').first().getByTestId('tabbar-close').click()
    await expect(page.getByRole('tab', { name: /Shortcut save/ })).toHaveCount(0)
    const chooser = page.waitForEvent('filechooser')
    const picking = await page.evaluateHandle(() => {
      const original = window.showOpenFilePicker
      window.showOpenFilePicker = undefined
      return { restore: () => (window.showOpenFilePicker = original) }
    })
    try {
      await page.getByTestId('home-open-file').click()
      // The download keeps a temporary name; pick it as the file the person saved.
      await (
        await chooser
      ).setFiles({
        name: file.suggestedFilename(),
        mimeType: 'application/octet-stream',
        buffer: await readFile(path)
      })
    } finally {
      await picking.evaluate((handle) => handle.restore())
      await picking.dispose()
    }
    await expect(page.getByRole('tab', { name: /Shortcut save/ })).toHaveCount(1)
    await expect
      .poll(() =>
        page.evaluate(() => {
          const store = window.lawha?.getStore?.()
          return store?.graph
            .getChildren(store.state.currentPageId)
            .map((node) => [node.type, node.width, node.height])
        })
      )
      .toEqual([['RECTANGLE', 100, 100]])
  } finally {
    await picker.evaluate((handle) => handle.restore())
    await picker.dispose()
  }
})

test('browser reload warns about unsaved work', async ({ page }) => {
  // Browsers require a trusted interaction before showing a beforeunload prompt.
  await page.getByTestId('tabbar-close').click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel', exact: true }).click()
  const dialogPromise = page.waitForEvent('dialog')
  const reload = page.evaluate(() => window.location.reload())
  const dialog = await dialogPromise
  expect(dialog.type()).toBe('beforeunload')
  await dialog.dismiss()
  await reload
  await expect(page.getByRole('img', { name: 'Unsaved changes' })).toBeVisible()
})
