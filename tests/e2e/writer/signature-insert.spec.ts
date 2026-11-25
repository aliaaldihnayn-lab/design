import { expect, test, type Page } from '#tests/e2e/fixtures'

test.describe.configure({ timeout: 120_000 })

async function drawSignature(page: Page) {
  await page.getByTestId('writer-signature').click()
  const dialog = page.getByTestId('writer-signature-dialog')
  const canvas = dialog.getByTestId('writer-signature-canvas')
  const box = await canvas.boundingBox()
  if (!box) throw new Error('The signature pad is not laid out')
  await page.mouse.move(box.x + 40, box.y + 80)
  await page.mouse.down()
  for (let step = 0; step < 30; step += 1) {
    await page.mouse.move(box.x + 40 + step * 12, box.y + 80 + Math.cos(step / 2) * 30)
  }
  await page.mouse.up()
  await dialog.getByTestId('writer-signature-insert').click()
}

const sizeOf = async (page: Page) => {
  const box = await page
    .getByTestId('writer-body')
    .getByRole('img', { name: 'Signature' })
    .boundingBox()
  return box ? Math.round(box.width) : 0
}

test('a placed signature resizes by its corner and the resize undoes', async ({ page }) => {
  // Undo groups changes made within half a second, as ProseMirror's history does by its clock.
  await page.clock.install()
  await page.goto('/writer?test')
  const body = page.getByTestId('writer-body')
  await expect(body).toBeVisible({ timeout: 30_000 })
  await body.click()
  await drawSignature(page)
  const signature = body.getByRole('img', { name: 'Signature' })
  await expect(signature).toBeVisible()
  const placed = await sizeOf(page)
  expect(placed).toBeGreaterThan(0)
  await page.clock.fastForward(1000)

  await signature.click()
  const corner = body.locator('[data-resize-handle="bottom-right"]')
  const handle = await corner.boundingBox()
  if (!handle || handle.width === 0) throw new Error('The corner handle cannot be grabbed')
  const x = handle.x + handle.width / 2
  const y = handle.y + handle.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + 100, y + 50, { steps: 8 })
  await page.mouse.up()
  await expect.poll(() => sizeOf(page)).toBeGreaterThan(placed + 40)

  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => sizeOf(page)).toBe(placed)
})
