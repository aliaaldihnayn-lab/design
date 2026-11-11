import { expect, test } from '#tests/e2e/fixtures'

test.describe.configure({ timeout: 60_000 })

test('edits and deletes a footnote after inserting it', async ({ page }) => {
  await page.goto('/writer?test')
  const body = page.getByTestId('writer-body')
  await expect(body).toBeVisible({ timeout: 30_000 })
  await body.click()
  await page.keyboard.type('Claim')

  await page.getByTestId('writer-footnote').click()
  await page.getByRole('textbox', { name: 'Footnote' }).first().fill('First source')
  await page.getByRole('button', { name: 'Insert', exact: true }).click()

  const notes = page.getByTestId('writer-footnotes')
  const note = notes.getByTestId('writer-footnote-note')
  await expect(note).toHaveCount(1)
  await expect(note).toContainText('First source')

  // Clicking the reference puts the cursor in the note, where typing edits it.
  await body.locator('sup[data-footnote]').click()
  await page.keyboard.type(', page 4')
  await expect(note).toContainText('First source, page 4')
  await expect(body).toContainText('Claim')

  await note.hover()
  await note.getByRole('button', { name: 'Delete footnote' }).click()
  await expect(notes).toBeHidden()
  await expect(body.locator('sup[data-footnote]')).toHaveCount(0)
})
