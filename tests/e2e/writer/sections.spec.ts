import { readFileSync } from 'node:fs'

import { nodeText, readDocx, writerSections } from '@lawha/core/writer'

import { expect, test } from '#tests/e2e/fixtures'
import { testPath } from '#tests/helpers/paths'
import { nextSave, openWordFile } from '#tests/helpers/writer/files'

test.describe.configure({ timeout: 120_000 })

/** Each section's header text, as Word shows it. */
const headers = (bytes: Uint8Array) =>
  writerSections(readDocx(bytes)).map((section) =>
    section.header ? nodeText(section.header) : null
  )

test('shows and edits the first section header of a Word file with several', async ({ page }) => {
  const source = new Uint8Array(
    readFileSync(testPath('fixtures/writer/lawha-section-headers.docx'))
  )
  await page.goto('/writer?test')
  await expect(page.getByTestId('writer-body')).toBeVisible({ timeout: 30_000 })
  const files = await openWordFile(page, source, 'sections.docx')

  // The first page belongs to the first section, whose header is its own.
  const header = page.getByTestId('writer-header')
  await expect(header).toHaveText(headers(source)[0] ?? '')
  await header.click()
  await page.keyboard.press('End')
  await page.keyboard.type(' 2026')
  await page.keyboard.press('ControlOrMeta+s')

  const saved = await nextSave(files, 0)
  expect(headers(saved)).toEqual([`${headers(source)[0]} 2026`, ...headers(source).slice(1)])
})
