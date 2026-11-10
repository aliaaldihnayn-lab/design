import { PDFDocument } from '@cantoo/pdf-lib'

/**
 * Encrypts a PDF with AES-256 (PDF 2.0 security handler, revision 6): the user password opens
 * it, and the owner password, when different, is needed to print, copy or edit beyond what
 * `permissions` allows.
 */
export async function encryptPDF(
  pdf: Uint8Array,
  userPassword: string,
  ownerPassword: string = userPassword
): Promise<Uint8Array> {
  const loaded = await PDFDocument.load(pdf, { updateMetadata: false })
  loaded.encrypt({
    userPassword,
    ownerPassword,
    permissions: { printing: 'highResolution', copying: true, modifying: false, annotating: true }
  })
  return loaded.save()
}
