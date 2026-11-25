import { expect, test } from '@playwright/test'

import { openHome } from '#tests/helpers/home'

for (const width of [390, 1280]) {
  test(`home view selection remains selected and persists at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    await openHome(page)
    const home = page.getByTestId('recent-files-home')
    await expect(home).toBeVisible()
    const grid = home.getByRole('button', { name: 'Grid view', exact: true })
    const list = home.getByRole('button', { name: 'List view', exact: true })
    await expect(grid).toHaveCount(1)
    await expect(grid).toHaveAttribute('aria-pressed', 'true')
    await grid.click()
    await expect(grid).toHaveAttribute('aria-pressed', 'true')
    await list.click()
    await expect(list).toHaveAttribute('aria-pressed', 'true')
    await openHome(page, 'reload')
    await expect(list).toHaveAttribute('aria-pressed', 'true')
  })
}
