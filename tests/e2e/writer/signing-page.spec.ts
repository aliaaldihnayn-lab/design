import { readFileSync } from 'node:fs'

import { fromUint8Array } from 'js-base64'

import { expect, test, type Page } from '#tests/e2e/fixtures'
import { testPath } from '#tests/helpers/paths'

/**
 * The page a signer reaches from their email, against a Cloud API answered by the test. The
 * signing steps need a build with Cloud (`VITE_LAWHA_CLOUD=on`) and skip without one.
 */
test.describe.configure({ timeout: 120_000 })

const SIGNER = '3f0c8f5e-2a51-4bb8-9f53-6f1f9d0e2a11'
const SECRET = 'a'.repeat(64)
const FONT = 'https://fonts.gstatic.com/lawha-test/script.ttf'

/** A one-page PDF written by hand. */
function onePagePDF(): string {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
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
  return fromUint8Array(new TextEncoder().encode(body))
}

interface CloudDouble {
  discoveries: number
  signed: Array<{ signature: string }>
}

/**
 * Answers the signing page's Cloud requests; the script fonts' stylesheet serves an Arabic face
 * from the fixtures under every signature font's name, since the test has no network.
 */
async function serveCloud(page: Page, envelopeStatus: string): Promise<CloudDouble> {
  const double: CloudDouble = { discoveries: 0, signed: [] }
  await page.route('**/.well-known/lawha', async (route) => {
    double.discoveries += 1
    const base = new URL(route.request().url()).origin
    await route.fulfill({
      json: {
        protocolVersion: '1',
        deployment: 'self-hosted',
        apiURL: `${base}/api`,
        authURL: `${base}/api/auth`,
        localEditor: true,
        authentication: { socialProviders: [], enterpriseSSO: false, enrollmentMode: 'open' },
        capabilities: { documents: true, workspaces: true, collaboration: true }
      }
    })
  })
  await page.route(`**/api/signing/${SIGNER}/view`, (route) =>
    route.fulfill({
      json: {
        signing: {
          title: 'عقد الخدمة',
          message: 'يرجى التوقيع',
          senderName: 'سارة',
          signerName: 'علي الدهنين',
          signerStatus: envelopeStatus === 'sent' ? 'viewed' : 'pending',
          envelopeStatus,
          pdf: onePagePDF()
        }
      }
    })
  )
  await page.route(`**/api/signing/${SIGNER}/sign`, async (route) => {
    const body: unknown = route.request().postDataJSON()
    if (typeof body === 'object' && body && 'signature' in body) {
      double.signed.push({ signature: String(body.signature) })
    }
    await route.fulfill({ json: { ok: true } })
  })
  await page.route('https://fonts.googleapis.com/**', (route) =>
    route.fulfill({
      contentType: 'text/css',
      body: ['Aref Ruqaa', 'Reem Kufi', 'Great Vibes', 'Dancing Script']
        .map((family) => `@font-face { font-family: '${family}'; src: url(${FONT}); }`)
        .join('\n')
    })
  )
  await page.route(FONT, (route) =>
    route.fulfill({
      contentType: 'font/ttf',
      body: readFileSync(testPath('fixtures/fonts/NotoNaskhArabic-Regular.ttf'))
    })
  )
  return double
}

/** Opens the signer's link; false when this build has no Cloud to reach. */
async function openLink(page: Page, double: CloudDouble): Promise<boolean> {
  // Script errors, whether thrown or caught and logged; failed font requests are not.
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error' && /\b(Reference|Type|Syntax)Error\b/.test(message.text())) {
      if (!message.text().includes('Failed to fetch')) errors.push(message.text())
    }
  })
  await page.goto(`/sign/${SIGNER}#${SECRET}`)
  await expect(page.getByTestId('signing-view')).toBeVisible({ timeout: 30_000 })
  const settled = page
    .getByRole('alert')
    .or(page.getByRole('status'))
    .or(page.getByTestId('signing-draw'))
  await expect(settled.first()).toBeVisible({ timeout: 30_000 })
  expect(errors).toEqual([])
  return double.discoveries > 0
}

test('opens a signing link without a script error', async ({ page }) => {
  const double = await serveCloud(page, 'sent')
  await openLink(page, double)
  // The secret leaves the address bar once read.
  expect(new URL(page.url()).hash).toBe('')
})

test('signs with a name typed in an Arabic script face', async ({ page }) => {
  const double = await serveCloud(page, 'sent')
  test.skip(!(await openLink(page, double)), 'This build has no Lawha Cloud')

  await page.getByTestId('signing-draw').click()
  const dialog = page.getByTestId('writer-signature-dialog')
  await dialog.getByTestId('writer-signature-type').click()
  await dialog.getByTestId('writer-signature-text').fill('علي الدهنين')
  await dialog.getByRole('combobox').click()
  await page.getByRole('option', { name: 'Aref Ruqaa' }).click()
  await expect
    .poll(() =>
      page.evaluate(async () => {
        await document.fonts.ready
        return [...document.fonts].some(
          (face) => face.family.replaceAll('"', '') === 'Aref Ruqaa' && face.status === 'loaded'
        )
      })
    )
    .toBe(true)
  await dialog.getByTestId('writer-signature-insert').click()
  await expect(page.getByRole('img', { name: 'Signature' })).toBeVisible()

  // The button beside a signature clears it, and signing waits for a new one.
  await page.getByTestId('signing-draw').click()
  await expect(page.getByRole('img', { name: 'Signature' })).toHaveCount(0)
  await expect(page.getByTestId('signing-submit')).toBeDisabled()

  await page.getByTestId('signing-draw').click()
  await dialog.getByTestId('writer-signature-type').click()
  await dialog.getByTestId('writer-signature-text').fill('علي الدهنين')
  await dialog.getByTestId('writer-signature-insert').click()
  await page.getByTestId('signing-submit').click()
  await expect.poll(() => double.signed.length).toBe(1)
  expect(double.signed[0]?.signature.startsWith('iVBORw0KGgo')).toBe(true)
})

test('tells a signer the envelope was declined rather than cancelled', async ({ page }) => {
  const double = await serveCloud(page, 'declined')
  test.skip(!(await openLink(page, double)), 'This build has no Lawha Cloud')
  await expect(page.getByTestId('signing-draw')).toHaveCount(0)
  const status = page.getByTestId('signing-view').getByRole('status')
  await expect(status).toContainText('Declined')
  await expect(status).not.toContainText('Cancelled')
})
