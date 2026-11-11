import { expect, test } from '#tests/e2e/fixtures'

test.describe.configure({ timeout: 60_000 })

test('asks for a Picker key before choosing a Doc from Drive', async ({ page }) => {
  await page.goto('/writer?test')
  await expect(page.getByTestId('writer-body')).toBeVisible({ timeout: 30_000 })

  await page.getByTestId('writer-google').click()
  await expect(page.getByTestId('writer-google-link')).toBeVisible()
  await page.getByTestId('writer-google-pick').click()
  await expect(page.getByText('Add a Google Picker API key')).toBeVisible()
})
