import { pdfPageSizes } from '@lawha/core/pdf-sign'

import { expect, test } from '#tests/e2e/fixtures'

test.describe.configure({ timeout: 120_000 })

test('exports the document as a PDF file without the print dialog', async ({ page }) => {
  await page.goto('/writer?test')
  const body = page.getByTestId('writer-body')
  await expect(body).toBeVisible({ timeout: 30_000 })
  await body.click()
  await page.keyboard.type('مرحبا بالعالم. Hello world.')

  await page.evaluate(() => {
    const writes: number[][] = []
    Reflect.set(window, '__pdfWrites', writes)
    window.print = () => {
      throw new Error('The print dialog opened')
    }
    window.showSaveFilePicker = async () =>
      ({
        name: 'document.pdf',
        getFile: async () => new File([], 'document.pdf'),
        createWritable: async (): Promise<
          Pick<FileSystemWritableFileStream, 'write' | 'close'>
        > => ({
          write: async (data: FileSystemWriteChunkType) => {
            if (data instanceof Blob)
              writes.push(Array.from(new Uint8Array(await data.arrayBuffer())))
          },
          close: async () => undefined
        })
      }) as FileSystemFileHandle
  })
  await page.getByTestId('writer-export-pdf').click()
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const writes: unknown = Reflect.get(window, '__pdfWrites')
          return Array.isArray(writes) ? writes.length : 0
        }),
      { timeout: 60_000 }
    )
    .toBe(1)
  const bytes = new Uint8Array(
    await page.evaluate(() => {
      const writes: unknown = Reflect.get(window, '__pdfWrites')
      return Array.isArray(writes) ? (writes as number[][]).flat() : []
    })
  )
  expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe('%PDF-')
  // A4 by default, in points.
  const size = (await pdfPageSizes(bytes)).at(0)
  expect(size?.width).toBeCloseTo(595.3, 0)
  expect(size?.height).toBeCloseTo(841.9, 0)
})
