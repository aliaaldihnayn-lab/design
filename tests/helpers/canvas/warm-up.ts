import { chromium, selectors, type FullConfig } from '@playwright/test'

/**
 * A cold Vite server transforms the editor's modules on the first page load, which takes longer
 * than one test may run. Global setup opens the editor once, after Playwright started the server
 * and before any test, and waits until the canvas is ready, as `CanvasHelper.waitForInit` does,
 * so every spec meets a warm server.
 */
const COLD_START_TIMEOUT_MS = 300_000

export default async function warmUpEditor(config: FullConfig) {
  const project = config.projects.find((candidate) => candidate.name === 'lawha')
  const { baseURL, storageState, launchOptions, testIdAttribute } = project?.use ?? {}
  if (!baseURL) return
  if (testIdAttribute) selectors.setTestIdAttribute(testIdAttribute)
  const browser = await chromium.launch(launchOptions)
  try {
    const context = await browser.newContext({ baseURL, storageState })
    const page = await context.newPage()
    await page.goto('/?test', { timeout: COLD_START_TIMEOUT_MS })
    await page
      .getByTestId('canvas-element')
      .and(page.locator('[data-ready="1"]'))
      .waitFor({ timeout: COLD_START_TIMEOUT_MS })
    await context.close()
  } finally {
    await browser.close()
  }
}
