import { expect, test } from '#tests/e2e/fixtures'

test.describe.configure({ timeout: 60_000 })

test('saves, previews, compares, and restores versions of a document', async ({ page }) => {
  await page.goto('/writer?test')
  const body = page.getByTestId('writer-body')
  await expect(body).toBeVisible({ timeout: 30_000 })
  await body.click()
  await page.keyboard.type('The quick fox')

  await page.getByTestId('writer-history-toggle').click()
  const panel = page.locator('[data-slot="history-panel"]')
  await expect(panel).toBeVisible()
  await panel.getByRole('button', { name: 'Save version' }).click()
  const dialog = page.getByRole('dialog', { name: 'Save to version history' })
  await dialog.getByPlaceholder('Title').fill('First draft')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).not.toBeVisible()
  const draft = panel.locator('[data-slot="history-version"]', { hasText: 'First draft' })
  await expect(draft).toBeVisible()

  // Close the history to edit, then come back to it.
  await panel.getByRole('button', { name: 'Close version history' }).click()
  await body.click()
  await page.keyboard.press('End')
  await page.keyboard.type(' jumps')
  await page.getByTestId('writer-history-toggle').click()

  // Edits are listed by the paragraphs they touched.
  await panel.locator('[data-slot="history-session"]').first().getByRole('button').click()
  await expect(
    panel.locator('[data-slot="history-change"]', { hasText: 'Edited text in' }).first()
  ).toBeVisible()

  // A version shows read-only in the document's place.
  await draft.getByRole('button', { name: /First draft/ }).click()
  const preview = page.getByTestId('writer-history-preview')
  await expect(preview).toHaveText('The quick fox')
  await expect(preview).toHaveAttribute('contenteditable', 'false')
  await expect(body).toBeHidden()

  // Comparing marks the words added since.
  await draft.hover({ position: { x: 4, y: 4 } })
  await draft.hover()
  await draft.getByRole('button', { name: 'Version options' }).click()
  await page.getByRole('menuitem', { name: 'Compare with current' }).click()
  const changed = page.locator('[data-slot="writer-history-block"][data-change="changed"]')
  await expect(changed.locator('ins')).toHaveText(' jumps')

  // Restoring brings the version back and closes the history.
  await draft.hover({ position: { x: 4, y: 4 } })
  await draft.hover()
  await draft.getByRole('button', { name: 'Version options' }).click()
  await page.getByRole('menuitem', { name: 'Restore this version' }).click()
  await expect(panel).not.toBeVisible()
  await expect(body).toHaveText('The quick fox')

  await page.getByTestId('writer-history-toggle').click()
  await expect(panel.locator('[data-slot="history-version"][data-kind="restore"]')).toContainText(
    'Restored “First draft”'
  )
})
