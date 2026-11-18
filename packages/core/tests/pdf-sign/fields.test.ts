import { describe, expect, setDefaultTimeout, test } from 'bun:test'

import { PDFDocument } from '@cantoo/pdf-lib'
import { toUint8Array } from 'js-base64'

import {
  addSignatureFields,
  createSelfSignedCredentials,
  signatureFields,
  signPDF,
  verifyPDFSignatures
} from '@lawha/core/pdf-sign'

setDefaultTimeout(60_000)

const PNG = toUint8Array(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='
)

async function threePages(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  for (let index = 0; index < 3; index += 1) pdf.addPage([595, 842])
  return pdf.save()
}

const first = createSelfSignedCredentials({ name: 'علي', email: 'ali@example.com' })
const second = createSelfSignedCredentials({ name: 'Sara', email: 'sara@example.com' })

describe('signature fields', () => {
  test('a signature goes where it was placed, on any page', async () => {
    const signed = await signPDF(await threePages(), await first, {
      appearance: { page: 1, rect: [120, 300, 150, 50], png: PNG }
    })
    const [field] = await signatureFields(signed)
    expect(field).toMatchObject({ page: 1, rect: [120, 300, 150, 50], signed: true })
    expect(verifyPDFSignatures(signed)).toEqual([
      expect.objectContaining({ intact: true, coversWholeFile: true })
    ])
  })

  test('each signer signs their own field and earlier signatures stay valid', async () => {
    const prepared = await addSignatureFields(await threePages(), [
      { name: 'Ali', page: 0, rect: [72, 72, 160, 50] },
      { name: 'Sara', page: 2, rect: [360, 72, 160, 50] }
    ])
    expect((await signatureFields(prepared)).map(({ name, signed }) => [name, signed])).toEqual([
      ['Ali', false],
      ['Sara', false]
    ])
    const once = await signPDF(prepared, await first, {
      fieldName: 'Ali',
      appearance: { rect: [0, 0, 0, 0], png: PNG }
    })
    const twice = await signPDF(once, await second, { fieldName: 'Sara' })
    // Signing appends to the file, so the first signer's bytes are still the start of it.
    expect(twice.subarray(0, once.length)).toEqual(once)
    const fields = await signatureFields(twice)
    expect(fields).toEqual([
      { name: 'Ali', page: 0, rect: [72, 72, 160, 50], signed: true },
      { name: 'Sara', page: 2, rect: [360, 72, 160, 50], signed: true }
    ])
    const checks = verifyPDFSignatures(twice)
    expect(checks.map((check) => [check.signer.subject, check.intact])).toEqual([
      ['علي', true],
      ['Sara', true]
    ])
    expect(checks.map((check) => check.coversWholeFile)).toEqual([false, true])
  })

  test('a field name already in the file is refused', async () => {
    const prepared = await addSignatureFields(await threePages(), [
      { name: 'Ali', page: 0, rect: [72, 72, 160, 50] }
    ])
    expect(
      addSignatureFields(prepared, [{ name: 'Ali', page: 1, rect: [0, 0, 10, 10] }])
    ).rejects.toThrow()
  })
})
