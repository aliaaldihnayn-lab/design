import { createSelfSignedCredentials, writePKCS12 } from '@lawha/core/pdf-sign'

import { expect, test } from '#tests/e2e/fixtures'

test.describe.configure({ timeout: 120_000 })

test('imports a .pfx certificate, refusing it until the password is right', async ({ page }) => {
  const credentials = await createSelfSignedCredentials({ name: 'علي الدهنين' })
  const pfx = Array.from(writePKCS12(credentials, 'correct horse'))

  await page.goto('/writer?test')
  await expect(page.getByTestId('writer-body')).toBeVisible({ timeout: 30_000 })
  const offered = await page.evaluateHandle((bytes) => {
    const accepted: string[] = []
    const file = new File([new Uint8Array(bytes)], 'identity.pfx', {
      type: 'application/x-pkcs12'
    })
    window.showOpenFilePicker = async (options) => {
      for (const type of options?.types ?? []) accepted.push(...Object.values(type.accept).flat())
      return [{ getFile: async () => file } as FileSystemFileHandle]
    }
    return accepted
  }, pfx)

  await page.getByTestId('writer-sign-pdf').click()
  const dialog = page.getByTestId('writer-sign-pdf-dialog')
  await dialog.getByRole('button', { name: 'Import .p12 or .pfx' }).click()
  await expect(dialog.getByRole('button', { name: 'identity.pfx' })).toBeVisible()
  expect(await offered.evaluate((accepted) => accepted)).toEqual(
    expect.arrayContaining(['.p12', '.pfx'])
  )
  await offered.dispose()

  const password = dialog.getByTestId('writer-cert-password')
  await password.fill('wrong')
  await dialog.getByRole('button', { name: 'Apply' }).click()
  await expect(dialog.getByRole('alert')).toBeVisible({ timeout: 30_000 })
  await expect(dialog.getByTestId('writer-certificate')).toHaveCount(0)

  await password.fill('correct horse')
  await dialog.getByRole('button', { name: 'Apply' }).click()
  await expect(dialog.getByTestId('writer-certificate')).toContainText('علي الدهنين', {
    timeout: 30_000
  })
})
