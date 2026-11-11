import { describe, expect, setDefaultTimeout, test } from 'bun:test'

import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib'
import { toUint8Array } from 'js-base64'

import {
  createSelfSignedCredentials,
  readPKCS12,
  signPDF,
  SigningCredentialsError,
  summarizeCertificate,
  verifyPDFSignatures,
  writePKCS12
} from '@lawha/core/pdf-sign'

setDefaultTimeout(30_000)

async function samplePDF(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([595, 842])
  page.drawText('Contract', {
    x: 72,
    y: 760,
    size: 24,
    font: await pdf.embedFont(StandardFonts.Helvetica)
  })
  return pdf.save()
}

/** A 1×1 PNG, as a visible signature's appearance. */
const PNG = toUint8Array(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='
)

const credentials = createSelfSignedCredentials({
  name: 'علي الدهنين',
  email: 'signer@example.com',
  now: new Date('2026-11-10T00:00:00Z')
})

describe('PDF signing', () => {
  test('a self-signed certificate is made for signing and lasts three years', async () => {
    const summary = summarizeCertificate((await credentials).certificate)
    expect(summary).toMatchObject({
      subject: 'علي الدهنين',
      email: 'signer@example.com',
      selfSigned: true
    })
    expect(summary.notAfter.startsWith('2029-11-10')).toBe(true)
  })

  test('signs with a CAdES signature that covers the whole file', async () => {
    const signed = await signPDF(await samplePDF(), await credentials, {
      name: 'علي الدهنين',
      reason: 'Approval',
      location: 'Riyadh',
      appearance: { rect: [72, 72, 180, 60], png: PNG }
    })
    const text = new TextDecoder('latin1').decode(signed)
    expect(text).toContain('/SubFilter /ETSI.CAdES.detached')
    expect(text).toContain('/SigFlags 3')
    const [check] = verifyPDFSignatures(signed)
    expect(check).toMatchObject({ intact: true, coversWholeFile: true })
    expect(check.signer.subject).toBe('علي الدهنين')
  })

  test('detects a change made after signing', async () => {
    const signed = await signPDF(await samplePDF(), await credentials)
    const tampered = signed.slice()
    // One byte inside the first signed range, as an edit to the page would change.
    tampered[200] ^= 1
    expect(verifyPDFSignatures(tampered)[0].intact).toBe(false)
  })

  test('keeps credentials in a password-protected PKCS #12 file', async () => {
    const p12 = writePKCS12(await credentials, 'secret')
    const opened = readPKCS12(p12, 'secret')
    expect(summarizeCertificate(opened.certificate).fingerprint).toBe(
      summarizeCertificate((await credentials).certificate).fingerprint
    )
    expect(() => readPKCS12(p12, 'wrong')).toThrow(SigningCredentialsError)
  })
})
