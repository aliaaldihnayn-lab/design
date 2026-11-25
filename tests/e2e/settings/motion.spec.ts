import { expect, test } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'

for (const appearance of [undefined, null, { animations: 'invalid' }]) {
  test.describe(`legacy animation preferences ${JSON.stringify(appearance)}`, () => {
    test.use({
      storageState: async ({ baseURL }, use) => {
        if (!baseURL) throw new Error('Browser test baseURL is required')
        await use({
          cookies: [],
          origins: [
            {
              origin: new URL(baseURL).origin,
              localStorage: [
                {
                  name: 'lawha:preferences:v1',
                  value: JSON.stringify({ version: 1, appearance })
                }
              ]
            }
          ]
        })
      }
    })
    test('normalizes the preference', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'no-preference' })
      await page.goto('/?test')
      await new CanvasHelper(page).waitForInit()
      await expect(page.locator('html')).toHaveAttribute('data-motion', 'full')
    })
  })
}

test('animation preference follows live system changes and persists the Off override', async ({
  page
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/?test')
  await new CanvasHelper(page).waitForInit()
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'full')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'off')
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.getByTestId('app-settings-trigger').click()
  await page.getByRole('combobox', { name: 'Animations', exact: true }).click()
  await page.getByRole('option', { name: 'Off', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'off')
  await expect(page.getByTestId('app-settings-dialog')).toHaveCSS('animation-name', 'none')
  await page.reload()
  await new CanvasHelper(page).waitForInit()
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'off')
  await page.getByTestId('app-settings-trigger').click()
  await page.getByRole('combobox', { name: 'Animations', exact: true }).click()
  await page.getByRole('option', { name: 'Follow system', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'full')
})

test('preferences another tab stores apply here and keep every other section', async ({
  context,
  page
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error' && message.text().includes('TypeError')) {
      errors.push(message.text())
    }
  })
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/?test')
  await new CanvasHelper(page).waitForInit()
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'full')

  const other = await context.newPage()
  await other.goto('/?test')
  await other.evaluate(() =>
    // oxlint-disable-next-line lawha/no-direct-storage-access -- Another tab or an older build writes the stored preferences.
    localStorage.setItem(
      'lawha:preferences:v1',
      JSON.stringify({ version: 1, appearance: { animations: 'off' } })
    )
  )
  await other.close()

  await expect(page.locator('html')).toHaveAttribute('data-motion', 'off')
  await page.getByTestId('app-settings-trigger').click()
  await expect(page.getByRole('combobox', { name: 'Animations', exact: true })).toHaveText('Off')
  expect(errors).toEqual([])
})
