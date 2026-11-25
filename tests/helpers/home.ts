import type { Page } from '@playwright/test'

/**
 * Driver: loads or reloads the app on its Home tab and waits for Home to draw, as
 * `CanvasHelper.waitForInit` waits for the canvas: a cold start can take longer than an
 * assertion's default wait.
 */
export async function openHome(page: Page, url: string | 'reload' = '/?recent-files') {
  if (url === 'reload') await page.reload()
  else await page.goto(url)
  await page.getByTestId('recent-files-home').waitFor({ timeout: 30000 })
}
