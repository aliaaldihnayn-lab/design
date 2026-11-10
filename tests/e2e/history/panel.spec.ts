import type { Locator, Page } from '@playwright/test'

import { expect, test } from '#tests/e2e/fixtures'
import { CanvasHelper } from '#tests/helpers/canvas'

// Each test opens the editor fresh and, for the reload, twice.
test.describe.configure({ timeout: 60_000 })

function paletteShortcut() {
  return process.platform === 'darwin' ? 'Meta+KeyK' : 'Control+KeyK'
}

async function runCommand(page: Page, name: RegExp) {
  await page.keyboard.press(paletteShortcut())
  const palette = page.getByRole('dialog', { name: 'Command palette' })
  await palette.getByRole('searchbox', { name: 'Search commands' }).fill('version')
  await palette.getByRole('option', { name }).click()
  await expect(palette).not.toBeVisible()
}

/** The x of the layer named `name` in the document the tab shows. */
function layerX(page: Page, name: string) {
  return page.evaluate((layer) => {
    const store = window.lawha?.getStore?.()
    const node = store && [...store.graph.getAllNodes()].find((item) => item.name === layer)
    return node?.x ?? null
  }, name)
}

/** Moves the card, then adds a badge, as two edits. */
async function editCard(page: Page, x: number) {
  await page.evaluate((next) => {
    const store = window.lawha?.getStore?.()
    if (!store) throw new Error('Lawha store not initialized')
    const card = [...store.graph.getAllNodes()].find((node) => node.name === 'Card')
    if (!card) throw new Error('No card')
    store.recordEdit({ label: 'Move' }, () => store.graph.updateNode(card.id, { x: next }))
    store.recordEdit({ label: 'Rectangle' }, () =>
      store.graph.createNode('RECTANGLE', store.state.currentPageId, { name: 'Badge', x: 20 })
    )
  }, x)
}

/**
 * A version's options show while the pointer is over it, as in Figma. The pointer moves within
 * the entry, so the hover holds even when the panel was drawn again beneath a still pointer.
 */
async function openVersionMenu(version: Locator) {
  await version.hover({ position: { x: 4, y: 4 } })
  await version.hover()
  await version.getByRole('button', { name: 'Version options' }).click()
}

const layerRow = (page: Page, name: string) =>
  page.getByTestId('layers-item').filter({ hasText: name })

test('saves, previews, compares, restores, and duplicates versions of a design', async ({
  page
}) => {
  await page.goto('/?test')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  await page.evaluate(() => {
    const store = window.lawha?.getStore?.()
    if (!store) throw new Error('Lawha store not initialized')
    store.recordEdit({ label: 'Rectangle' }, () =>
      store.graph.createNode('RECTANGLE', store.state.currentPageId, {
        name: 'Card',
        x: 100,
        y: 100,
        width: 200,
        height: 120
      })
    )
  })

  await runCommand(page, /Save to version history/i)
  const dialog = page.getByRole('dialog', { name: 'Save to version history' })
  await dialog.getByPlaceholder('Title').fill('First draft')
  await dialog.getByPlaceholder('Describe what changed').fill('Card in place')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).not.toBeVisible()

  await editCard(page, 400)
  await runCommand(page, /Show version history/i)
  const panel = page.locator('[data-slot="history-panel"]')
  await expect(panel).toBeVisible()
  const draft = panel.locator('[data-slot="history-version"]', { hasText: 'First draft' })
  await expect(draft).toBeVisible()
  await expect(draft).toContainText('Card in place')

  // Sessions open onto the edits they hold, worded by what they did.
  await panel.locator('[data-slot="history-session"]').first().getByRole('button').click()
  await expect(
    panel.locator('[data-slot="history-change"]', { hasText: 'Moved Card' })
  ).toBeVisible()

  // Previewing shows the version read-only in the document's place.
  await expect(layerRow(page, 'Badge')).toHaveCount(1)
  await draft.getByRole('button', { name: /First draft/ }).click()
  await expect(layerRow(page, 'Badge')).toHaveCount(0)
  await expect(layerRow(page, 'Card')).toHaveCount(1)
  // The document itself is untouched.
  expect(await layerX(page, 'Card')).toBe(400)
  await panel.getByRole('button', { name: 'Current version' }).click()
  await expect(layerRow(page, 'Badge')).toHaveCount(1)

  // Comparing lists and selects what changed since the version.
  await openVersionMenu(draft)
  await page.getByRole('menuitem', { name: 'Compare with current' }).click()
  const compared = panel.locator('[data-slot="history-compared-layer"]')
  await expect(compared).toHaveCount(2)
  await expect(compared.filter({ hasText: 'Card' })).toHaveAttribute('data-change', 'changed')
  await expect(compared.filter({ hasText: 'Badge' })).toHaveAttribute('data-change', 'added')

  // Duplicating opens the version as a new file.
  await expect(page.getByTestId('tabbar-tab')).toHaveCount(1)
  await openVersionMenu(draft)
  await page.getByRole('menuitem', { name: 'Duplicate as new file' }).click()
  await expect(page.getByTestId('tabbar-tab')).toHaveCount(2)
  await expect.poll(() => layerX(page, 'Card')).toBe(100)
  await expect.poll(() => layerX(page, 'Badge')).toBeNull()
  // Closing the copy goes back to the document.
  await page
    .locator('[data-slot="tab-item"]', { hasText: '(copy)' })
    .getByTestId('tabbar-close')
    .click()
  await expect(page.getByTestId('tabbar-tab')).toHaveCount(1)

  // Restoring brings the version back as an edit of its own, which undo takes back.
  await runCommand(page, /Show version history/i)
  await openVersionMenu(draft)
  await page.getByRole('menuitem', { name: 'Restore this version' }).click()
  await expect(panel).not.toBeVisible()
  await expect.poll(() => layerX(page, 'Card')).toBe(100)
  expect(await layerX(page, 'Badge')).toBeNull()
  await runCommand(page, /Show version history/i)
  await expect(panel.locator('[data-slot="history-version"][data-kind="restore"]')).toContainText(
    'Restored “First draft”'
  )
  await panel.getByRole('button', { name: 'Close version history' }).click()
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => layerX(page, 'Card')).toBe(400)
})

test('keeps the history of an unsaved design across a reload', async ({ page }) => {
  await page.goto('/?test')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  await page.evaluate(async () => {
    const store = window.lawha?.getStore?.()
    if (!store) throw new Error('Lawha store not initialized')
    const id = store.createShape('RECTANGLE', 10, 10, 200, 100)
    store.updateNode(id, { name: 'Card' })
    await store.persistRecoveryNow()
  })
  await runCommand(page, /Save to version history/i)
  const dialog = page.getByRole('dialog', { name: 'Save to version history' })
  await dialog.getByPlaceholder('Title').fill('Kept across reloads')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).not.toBeVisible()

  page.once('dialog', (prompt) => prompt.accept())
  await page.reload()
  // The editor loads again before it offers the recovered document.
  await expect(page.getByRole('alertdialog', { name: 'Recover unsaved work' })).toBeVisible({
    timeout: 30_000
  })
  await page.getByRole('button', { name: 'Restore' }).click()
  await expect.poll(() => layerX(page, 'Card')).toBe(10)

  await runCommand(page, /Show version history/i)
  await expect(
    page.locator('[data-slot="history-version"]', { hasText: 'Kept across reloads' })
  ).toBeVisible()
})
