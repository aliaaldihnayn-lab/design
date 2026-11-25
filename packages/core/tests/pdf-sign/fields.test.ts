import { describe, expect, setDefaultTimeout, test } from 'bun:test'

import { PDFDocument, PDFName, StandardFonts } from '@cantoo/pdf-lib'
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

  test('a later signature leaves the page content earlier signatures cover as it was', async () => {
    const pdf = await PDFDocument.create()
    const font = await pdf.embedFont(StandardFonts.Helvetica)
    for (let index = 0; index < 2; index += 1) {
      pdf.addPage([595, 842]).drawText(`Page ${index + 1}`, { x: 72, y: 760, font })
    }
    const once = await signPDF(await pdf.save(), await first, {
      appearance: { page: 1, rect: [72, 72, 150, 50], png: PNG }
    })
    // The second signature is a new field on the first page.
    const twice = await signPDF(once, await second, {
      appearance: { page: 0, rect: [300, 72, 150, 50], png: PNG }
    })
    const contents = async (bytes: Uint8Array) =>
      (await PDFDocument.load(bytes))
        .getPages()
        .map((page) => String(page.node.get(PDFName.of('Contents'))))
    expect(await contents(twice)).toEqual(await contents(once))
    expect((await signatureFields(twice)).map((field) => field.page)).toEqual([0, 1])
  })

  test('adds a field to a page whose annotations are an indirect array', async () => {
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Annots 4 0 R >>',
      '[ ]'
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
    const placed = await addSignatureFields(new TextEncoder().encode(body), [
      { name: 'Signer', page: 0, rect: [72, 72, 150, 50] }
    ])
    expect(await signatureFields(placed)).toEqual([
      { name: 'Signer', page: 0, rect: [72, 72, 150, 50], signed: false }
    ])
  })
})
