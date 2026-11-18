import { signatureFields, verifyPDFSignatures } from '@lawha/core/pdf-sign'

import { expect, test } from '#tests/e2e/fixtures'

test.describe.configure({ timeout: 120_000 })

/** A two-page A4 PDF written by hand, so the test needs no PDF library of its own. */
function twoPagePDF(): Uint8Array {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>'
  ]
  let body = '%PDF-1.7\n'
  const offsets: number[] = []
  objects.forEach((object, index) => {
    offsets.push(body.length)
    body += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = body.length
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) body += `${String(offset).padStart(10, '0')} 00000 n \n`
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new TextEncoder().encode(body)
}

test('places a visible signature where the person clicks, on the page they chose', async ({
  page
}) => {
  await page.goto('/writer?test')
  await expect(page.getByTestId('writer-body')).toBeVisible({ timeout: 30_000 })
  await page.evaluate((bytes) => {
    const file = new File([new Uint8Array(bytes)], 'contract.pdf', { type: 'application/pdf' })
    window.showOpenFilePicker = async () => [{ getFile: async () => file } as FileSystemFileHandle]
    const writes: number[][] = []
    Reflect.set(window, '__signedWrites', writes)
    window.showSaveFilePicker = async () =>
      ({
        name: 'contract-signed.pdf',
        getFile: async () => new File([], 'contract-signed.pdf'),
        createWritable: async (): Promise<
          Pick<FileSystemWritableFileStream, 'write' | 'close'>
        > => ({
          write: async (data: FileSystemWriteChunkType) => {
            if (data instanceof Uint8Array) writes.push(Array.from(data))
            else if (data instanceof Blob)
              writes.push(Array.from(new Uint8Array(await data.arrayBuffer())))
          },
          close: async () => undefined
        })
      }) as FileSystemFileHandle
  }, Array.from(twoPagePDF()))

  await page.getByTestId('writer-sign-pdf').click()
  const dialog = page.getByTestId('writer-sign-pdf-dialog')
  await dialog.getByTestId('writer-cert-name').fill('Signer')
  await dialog.getByTestId('writer-cert-password').fill('secret-123')
  await dialog.getByTestId('writer-cert-confirm').fill('secret-123')
  await dialog.getByTestId('writer-cert-create').click()
  await expect(dialog.getByTestId('writer-certificate')).toBeVisible({ timeout: 60_000 })

  await dialog.getByTestId('writer-choose-pdf').click()
  const surface = dialog.getByTestId('writer-sign-surface')
  await expect(surface).toBeVisible({ timeout: 30_000 })
  // It opens on the last page; go to the first and click a quarter across, 30% down.
  await expect(dialog.getByTestId('writer-sign-page')).toHaveText('Page 2 of 2')
  await dialog.getByRole('button', { name: 'Previous page' }).click()
  await expect(dialog.getByTestId('writer-sign-page')).toHaveText('Page 1 of 2')
  const box = await surface.boundingBox()
  if (!box) throw new Error('no surface')
  await surface.click({ position: { x: box.width * 0.25, y: box.height * 0.3 } })

  await dialog.getByTestId('writer-sign-password').fill('secret-123')
  await dialog.getByTestId('writer-sign').click()
  await expect(dialog.getByText('Signed PDF saved')).toBeVisible({ timeout: 60_000 })

  const written = await page.evaluate(() => {
    const writes: unknown = Reflect.get(window, '__signedWrites')
    return Array.isArray(writes) ? (writes as number[][]).flat() : []
  })
  const signed = new Uint8Array(written)
  const field = (await signatureFields(signed)).at(0)
  expect(field?.page).toBe(0)
  expect(field?.signed).toBe(true)
  const [x, y, width, height] = field?.rect ?? [0, 0, 0, 0]
  expect(x + width / 2).toBeCloseTo(595 * 0.25, -1)
  expect(y + height / 2).toBeCloseTo(842 * 0.7, -1)
  expect(verifyPDFSignatures(signed)).toEqual([expect.objectContaining({ intact: true })])
})
