import { strFromU8, unzipSync } from 'fflate'

import { createWriterDocument, nodeText, readDocx, writeDocx } from '@lawha/core/writer'

import { expect, test } from '#tests/e2e/fixtures'
import { nextSave, openWordFile } from '#tests/helpers/writer/files'

test.describe.configure({ timeout: 120_000 })

const change = (type: 'insertion' | 'deletion', text: string, author: string) => ({
  type: 'text',
  text,
  marks: [{ type, attrs: { author, date: '2026-01-02T00:00:00Z' } }]
})

/** A Word file with a tracked insertion and deletion in Arabic, and a comment. */
const reviewed = writeDocx(
  createWriterDocument({
    body: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { dir: 'rtl' },
          content: [
            { type: 'text', text: 'يبقى ' },
            change('insertion', 'مضاف ', 'سارة'),
            change('deletion', 'محذوف ', 'خالد'),
            { type: 'text', text: 'النهاية.' }
          ]
        },
        {
          type: 'paragraph',
          attrs: { dir: 'rtl' },
          content: [
            {
              type: 'text',
              text: 'بند للمراجعة',
              marks: [{ type: 'comment', attrs: { commentId: 'c0' } }]
            }
          ]
        }
      ]
    },
    comments: [{ id: 'c0', author: 'سارة', date: '2026-01-02T00:00:00Z', text: 'راجع البند' }]
  })
)

test('accepts and rejects tracked changes and resolves a comment, then saves them', async ({
  page
}) => {
  await page.goto('/writer?test')
  const body = page.getByTestId('writer-body')
  await expect(body).toBeVisible({ timeout: 30_000 })
  const files = await openWordFile(page, reviewed, 'review.docx')
  await expect(body).toContainText('بند للمراجعة')

  await page.getByTestId('writer-changes-toggle').click()
  const changes = page.getByTestId('writer-change')
  await expect(changes).toHaveCount(2)
  await changes.filter({ hasText: 'مضاف' }).getByRole('button', { name: 'Accept' }).click()
  await expect(changes).toHaveCount(1)
  await changes.filter({ hasText: 'محذوف' }).getByRole('button', { name: 'Reject' }).click()
  await expect(changes).toHaveCount(0)

  await page.getByTestId('writer-comments-toggle').click()
  await page.getByRole('button', { name: 'Resolve' }).click()
  await expect(page.getByRole('button', { name: 'Reopen' })).toBeVisible()

  await page.keyboard.press('ControlOrMeta+s')
  const saved = await nextSave(files, 0)
  const read = readDocx(saved)
  // Accepting keeps the insertion as text; rejecting the deletion keeps the deleted words.
  expect(nodeText(read.body).split('\n')[0]).toBe('يبقى مضاف محذوف النهاية.')
  const xml = strFromU8(unzipSync(saved)['word/document.xml'])
  expect(xml).not.toContain('<w:ins ')
  expect(xml).not.toContain('<w:del ')
  expect(read.comments).toMatchObject([{ text: 'راجع البند', resolved: true }])
})

test('records typing as a tracked insertion when track changes is on', async ({ page }) => {
  await page.goto('/writer?test')
  const body = page.getByTestId('writer-body')
  await expect(body).toBeVisible({ timeout: 30_000 })
  const files = await openWordFile(page, reviewed, 'review.docx')
  await expect(body).toContainText('بند للمراجعة')

  await page.getByTestId('writer-changes-toggle').click()
  await page.getByTestId('writer-track-switch').click()
  await body.getByText('بند للمراجعة').click()
  await page.keyboard.press('End')
  await page.keyboard.type(' جديد')
  await expect(page.getByTestId('writer-change')).toHaveCount(3)

  await page.keyboard.press('ControlOrMeta+s')
  const saved = await nextSave(files, 0)
  const xml = strFromU8(unzipSync(saved)['word/document.xml'])
  expect(xml).toMatch(/<w:ins [^>]*>(?:(?!<\/w:ins>).)*جديد/su)
  expect(readDocx(saved).trackChanges).toBe(true)
})
