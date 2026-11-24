import { readFileSync } from 'node:fs'

import { strFromU8, unzipSync } from 'fflate'

import { decryptDocx, nodeText, readDocx } from '@lawha/core/writer'

import { expect, test } from '#tests/e2e/fixtures'
import { testPath } from '#tests/helpers/paths'
import { nextSave, openWordFile } from '#tests/helpers/writer/files'

test.describe.configure({ timeout: 120_000 })

const fixture = (name: string) => new Uint8Array(readFileSync(testPath(`fixtures/writer/${name}`)))

test('shows unstyled text of a Word file in its default face', async ({ page }) => {
  await page.goto('/writer?test')
  const body = page.getByTestId('writer-body')
  await expect(body).toBeVisible({ timeout: 30_000 })
  await openWordFile(page, fixture('word-sections.docx'), 'sections.docx')
  await expect(body).toContainText('T2')
  const family = await body
    .locator('p')
    .first()
    .evaluate((node) => getComputedStyle(node).fontFamily)
  expect(family.split(',')[0]).toContain('Calibri')
})

test('typing in a Word file keeps its other parts and blocks when saved', async ({ page }) => {
  const source = fixture('python-docx-rich.docx')
  await page.goto('/writer?test')
  const body = page.getByTestId('writer-body')
  await expect(body).toBeVisible({ timeout: 30_000 })
  const files = await openWordFile(page, source, 'rich.docx')
  await expect(body).toContainText('Commented text here.')

  await body.getByText('Centered English.').click()
  await page.keyboard.press('End')
  await page.keyboard.type(' مع نص عربي')
  await page.keyboard.press('ControlOrMeta+s')
  const saved = await nextSave(files, 0)

  const before = unzipSync(source)
  const after = unzipSync(saved)
  expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort())
  for (const path of Object.keys(before)) {
    if (path !== 'word/document.xml') expect(strFromU8(after[path])).toBe(strFromU8(before[path]))
  }
  const read = (bytes: Uint8Array) => (readDocx(bytes).body.content ?? []).map(nodeText)
  expect(read(saved)).toEqual(
    read(source).map((text) => (text === 'Centered English.' ? `${text} مع نص عربي` : text))
  )
  // The table keeps its Word style, which the model does not hold.
  expect(strFromU8(after['word/document.xml'])).toContain('<w:tblStyle w:val="TableGrid"/>')
})

test('saving a Word file with a password keeps what it held', async ({ page }) => {
  const source = fixture('python-docx-rich.docx')
  await page.goto('/writer?test')
  const body = page.getByTestId('writer-body')
  await expect(body).toBeVisible({ timeout: 30_000 })
  const files = await openWordFile(page, source, 'rich.docx')
  await expect(body).toContainText('Commented text here.')

  await page.getByTestId('writer-protect').click()
  await page.getByTestId('writer-protect-password').fill('كلمة سر')
  await page.getByTestId('writer-protect-confirm').fill('كلمة سر')
  await page.getByTestId('writer-protect-docx').click()
  const locked = await nextSave(files, 0)

  expect(() => readDocx(locked)).toThrow('encrypted')
  const opened = unzipSync(decryptDocx(locked, 'كلمة سر'))
  const before = unzipSync(source)
  expect(Object.keys(opened).sort()).toEqual(Object.keys(before).sort())
  expect(strFromU8(opened['word/theme/theme1.xml'])).toBe(
    strFromU8(before['word/theme/theme1.xml'])
  )
  expect(strFromU8(opened['word/document.xml'])).toContain('<w:tblStyle w:val="TableGrid"/>')
})
