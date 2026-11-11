import type { Page } from '@playwright/test'

import {
  createWriterDocument,
  defaultPageSetup,
  writeDocx,
  type WriterDocument,
  type WriterNode
} from '@lawha/core/writer'

import { expect, test } from '#tests/e2e/fixtures'

test.describe.configure({ timeout: 120_000 })

const paragraph = (text: string): WriterNode => ({
  type: 'paragraph',
  content: [{ type: 'text', text }]
})

/** Opens a Word file made from `doc` through the editor's Open button. */
async function open(page: Page, doc: WriterDocument) {
  await page.goto('/writer?test')
  await expect(page.getByTestId('writer-body')).toBeVisible({ timeout: 30_000 })
  await page.evaluate(
    (bytes) => {
      const file = new File([new Uint8Array(bytes)], 'test.docx')
      window.showOpenFilePicker = async () => [
        { getFile: async () => file } as FileSystemFileHandle
      ]
    },
    Array.from(writeDocx(doc))
  )
  await page.getByTestId('writer-open').click()
}

/** Whether any text line of the body overlaps a page gap. */
const linesInGaps = (page: Page) =>
  page.evaluate(() => {
    const gaps = Array.from(document.querySelectorAll('.writer-page-gap')).map((gap) =>
      gap.getBoundingClientRect()
    )
    const body = document.querySelector('[data-test-id="writer-body"]')
    if (!body) return -1
    const range = document.createRange()
    range.selectNodeContents(body)
    return Array.from(range.getClientRects()).filter((line) =>
      gaps.some(
        (gap) =>
          line.height > 0 &&
          line.height < 40 &&
          line.top < gap.bottom - 1 &&
          line.bottom > gap.top + 1 &&
          !document
            .elementFromPoint(line.left + 1, line.top + line.height / 2)
            ?.closest('.writer-page-gap')
      )
    ).length
  })

test('splits a paragraph taller than a page between its lines', async ({ page }) => {
  const long = 'A long clause that runs on and on without a paragraph break. '.repeat(400)
  await open(page, createWriterDocument({ body: { type: 'doc', content: [paragraph(long)] } }))
  const inside = page.locator('[data-test-id="writer-body"] > p .writer-page-gap')
  await expect.poll(() => inside.count(), { timeout: 30_000 }).toBeGreaterThan(1)
  expect(await linesInGaps(page)).toBe(0)
})

test('splits a table taller than a page between its rows', async ({ page }) => {
  const row = (index: number): WriterNode => ({
    type: 'tableRow',
    content: [
      { type: 'tableCell', content: [paragraph(`Row ${index}`)] },
      { type: 'tableCell', content: [paragraph('Value')] }
    ]
  })
  const table: WriterNode = {
    type: 'table',
    content: Array.from({ length: 90 }, (_, index) => row(index + 1))
  }
  await open(page, createWriterDocument({ body: { type: 'doc', content: [table] } }))
  const rows = page.locator('[data-test-id="writer-body"] tr.writer-page-gap-row')
  await expect.poll(() => rows.count(), { timeout: 30_000 }).toBeGreaterThan(0)
  await expect(rows.first().locator('.writer-page-gap')).toBeVisible()
})

test("draws each section's page at its own size", async ({ page }) => {
  const portrait = defaultPageSetup('a4')
  const landscape = { ...portrait, width: portrait.height, height: portrait.width }
  const body: WriterNode = {
    type: 'doc',
    content: [
      paragraph('Portrait section'),
      { type: 'sectionBreak', attrs: { page: portrait } },
      paragraph('Landscape annex')
    ]
  }
  await open(page, createWriterDocument({ body, page: landscape }))
  const sheets = page.getByTestId('writer-sheet')
  await expect(sheets).toHaveCount(2)
  const [first, second] = await sheets.evaluateAll((elements) =>
    elements.map((element) => element.getBoundingClientRect().width)
  )
  expect(first ?? 0).toBeLessThan(second ?? 0)
  // Each section's text sits inside its own sheet.
  const [portraitText, landscapeText] = await Promise.all(
    ['Portrait section', 'Landscape annex'].map((text) =>
      page.getByText(text).evaluate((element) => element.getBoundingClientRect().width)
    )
  )
  expect(portraitText).toBeLessThan(landscapeText ?? 0)
})
