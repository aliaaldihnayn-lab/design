import { readFile } from 'node:fs/promises'

import { expect, test, type Page } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'

/** Drops files on the canvas the way a drag from the desktop delivers them. */
async function dropOnCanvas(page: Page, files: Array<{ name: string; bytes: number[] }>) {
  await page.getByTestId('canvas-element').evaluate((canvas, dropped) => {
    const bounds = canvas.getBoundingClientRect()
    const transfer = new DataTransfer()
    for (const { name, bytes } of dropped)
      transfer.items.add(new File([new Uint8Array(bytes)], name))
    const options = {
      bubbles: true,
      cancelable: true,
      clientX: bounds.left + 200,
      clientY: bounds.top + 200,
      dataTransfer: transfer
    }
    canvas.dispatchEvent(new DragEvent('dragover', options))
    canvas.dispatchEvent(new DragEvent('drop', options))
  }, files)
}

test('a document dropped on the canvas opens in a new tab', async ({ page }) => {
  await page.goto('/?test')
  await new CanvasHelper(page).waitForInit()
  const tabs = page.getByRole('tablist').filter({ has: page.getByTestId('tabbar-tab') })

  const bytes = [...(await readFile('tests/fixtures/circle-text.fig'))]
  await dropOnCanvas(page, [{ name: 'circle-text.fig', bytes }])

  await expect(tabs.getByRole('tab').last()).toContainText('circle-text')
  await expect(tabs.getByRole('tab').last()).toHaveAttribute('aria-selected', 'true')
})

test('a dropped file that is neither a document nor an image reports that it cannot open', async ({
  page
}) => {
  await page.goto('/?test')
  await new CanvasHelper(page).waitForInit()
  const tabs = page.getByRole('tablist').filter({ has: page.getByTestId('tabbar-tab') })

  await dropOnCanvas(page, [{ name: 'notes.txt', bytes: [...new TextEncoder().encode('hello')] }])

  await expect(page.getByText('Could not open “notes.txt”', { exact: false })).toBeVisible()
  await expect(tabs.getByRole('tab')).toHaveCount(1)
})

test('a design token file dropped on the canvas opens the variables import', async ({ page }) => {
  await page.goto('/?test')
  await new CanvasHelper(page).waitForInit()
  const tokens = { color: { $type: 'color', brand: { $value: '#2563eb' } } }

  await dropOnCanvas(page, [
    { name: 'brand.tokens.json', bytes: [...new TextEncoder().encode(JSON.stringify(tokens))] }
  ])

  await expect(page.getByRole('dialog', { name: 'Import design tokens' })).toBeVisible()
  await expect(page.getByText('Could not open', { exact: false })).toHaveCount(0)
  // The modal dialog hides the tab bar from the accessibility tree, so tabs are counted by id.
  await expect(page.getByTestId('tabbar-tab')).toHaveCount(1)
})

test('an SVG dropped on the canvas is placed, not opened as a document', async ({ page }) => {
  await page.goto('/?test')
  await new CanvasHelper(page).waitForInit()
  const tabs = page.getByRole('tablist').filter({ has: page.getByTestId('tabbar-tab') })
  const tabName = (await tabs.getByRole('tab').first().textContent()) ?? ''
  const svg = '<svg width="20" height="20"><rect width="20" height="20" fill="#f00"/></svg>'

  await dropOnCanvas(page, [{ name: 'mark.svg', bytes: [...new TextEncoder().encode(svg)] }])

  await expect(page.getByTestId('layers-item').filter({ hasText: 'mark' })).toHaveCount(1)
  await expect(page.getByText('Could not open', { exact: false })).toHaveCount(0)
  await expect(tabs.getByRole('tab')).toHaveCount(1)
  await expect(tabs.getByRole('tab').first()).toHaveText(tabName)
})

test('an HTML page dropped on the canvas sizes its text in the page’s fonts', async ({ page }) => {
  await page.goto('/?test')
  await new CanvasHelper(page).waitForInit()
  const html = `<html dir="rtl"><body style="font-family: 'Noto Naskh Arabic'">
    <div style="display:flex"><span style="padding:8px 16px;background:#e8632c;color:#fff">متابعة</span></div>
  </body></html>`

  await dropOnCanvas(page, [{ name: 'button.html', bytes: [...new TextEncoder().encode(html)] }])

  // Laid out while its font was still loading, the label kept a stand-in's width and drew off to
  // one side of its button; it takes the width the loaded font measures.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const store = window.lawha?.getStore?.()
        const label = store
          ? [...store.graph.getAllNodes()].find((node) => node.text === 'متابعة')
          : undefined
        const measured = label ? store?.renderer?.measureTextNode(label) : null
        return label && measured ? Math.abs(label.width - measured.width) : null
      })
    )
    .toBeLessThan(1)
})
