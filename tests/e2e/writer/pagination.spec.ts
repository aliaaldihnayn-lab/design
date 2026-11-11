import { expect, test } from '#tests/e2e/fixtures'

test.describe.configure({ timeout: 90_000 })

test('flows the body onto pages, each with its footer and page number', async ({ page }) => {
  await page.goto('/writer?test')
  const body = page.getByTestId('writer-body')
  await expect(body).toBeVisible({ timeout: 30_000 })

  const footer = page.getByTestId('writer-footer')
  await footer.click()
  await page.keyboard.type('صفحة ')
  await page.getByRole('button', { name: 'Page number' }).click()
  await page.keyboard.type(' / ')
  await page.getByRole('button', { name: 'Page count' }).click()

  await body.click()
  for (let line = 0; line < 70; line += 1) {
    await page.keyboard.type(`سطر رقم ${line + 1} من نص المستند`)
    await page.keyboard.press('Enter')
  }

  const gaps = page.locator('.writer-page-gap')
  await expect(gaps).not.toHaveCount(0)
  const count = await gaps.count()
  // Each gap ends a page with that page's footer and starts the next.
  await expect(gaps.first().locator('.writer-page-footer')).toContainText('صفحة 1 / ')
  await expect(gaps.nth(count - 1).locator('.writer-page-footer')).toContainText(
    `صفحة ${count} / ${count + 1}`
  )
  // Every body line keeps to its page's text area: none runs into a gap.
  const boxes = await page.evaluate(() => {
    const gapBoxes = Array.from(document.querySelectorAll('.writer-page-gap')).map((gap) =>
      gap.getBoundingClientRect()
    )
    const lines = Array.from(document.querySelectorAll('[data-test-id="writer-body"] > p')).map(
      (line) => line.getBoundingClientRect()
    )
    return lines.filter((line) =>
      gapBoxes.some((gap) => line.top < gap.bottom - 1 && line.bottom > gap.top + 1)
    ).length
  })
  expect(boxes).toBe(0)

  // A page break starts a new page at once.
  const before = await gaps.count()
  await page.keyboard.press('ControlOrMeta+Enter')
  await expect.poll(() => gaps.count()).toBeGreaterThan(before)
})
