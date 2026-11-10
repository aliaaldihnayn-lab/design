import {
  concatTransformationMatrix,
  drawObject,
  PDFArray,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFString,
  popGraphicsState,
  pushGraphicsState
} from '@cantoo/pdf-lib'
import forge from 'node-forge'

import { cadesDetachedSignature, verifyCadesDetached } from './cms'
import {
  summarizeCertificate,
  type CertificateSummary,
  type SigningCredentials
} from './credentials'

/**
 * Signs a PDF the way Adobe Acrobat validates: a signature field whose dictionary is
 * `/Filter /Adobe.PPKLite /SubFilter /ETSI.CAdES.detached`, a byte range covering the whole file
 * except the signature itself, and a CAdES signature (PAdES B-B) in `/Contents`. Any change to
 * the file afterwards breaks the digest, which readers report as tampering.
 */

/** Room for the CMS: certificate chains of a few certificates fit in 16 KiB. */
const SIGNATURE_BYTES = 16_384
const BYTE_RANGE_PLACEHOLDER = '**********'

export interface SignatureAppearance {
  /** Zero-based page index; the last page by default. */
  page?: number
  /** x, y, width, height in PDF points from the page's bottom-left corner. */
  rect: [number, number, number, number]
  /** A PNG drawn into the rectangle, such as the visual signature and signer's name. */
  png?: Uint8Array
}

export interface SignPDFOptions {
  name?: string
  reason?: string
  location?: string
  contactInfo?: string
  /** The signing time written in `/M`; now by default. */
  date?: Date
  /** Without one the signature is invisible, listed only in the reader's signature panel. */
  appearance?: SignatureAppearance
  fieldName?: string
}

const latin1 = (bytes: Uint8Array) => {
  let out = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    out += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return out
}

async function addSignatureField(target: PDFDocument, options: SignPDFOptions): Promise<void> {
  const context = target.context
  const pages = target.getPages()
  const page = pages[Math.min(options.appearance?.page ?? pages.length - 1, pages.length - 1)]
  const placeholder = PDFName.of(BYTE_RANGE_PLACEHOLDER)
  const byteRange = PDFArray.withContext(context)
  byteRange.push(PDFNumber.of(0))
  byteRange.push(placeholder)
  byteRange.push(placeholder)
  byteRange.push(placeholder)
  const signature = context.obj({
    Type: 'Sig',
    Filter: 'Adobe.PPKLite',
    SubFilter: 'ETSI.CAdES.detached',
    ByteRange: byteRange,
    Contents: PDFHexString.of('0'.repeat(SIGNATURE_BYTES * 2)),
    M: PDFString.fromDate(options.date ?? new Date())
  })
  if (options.name) signature.set(PDFName.of('Name'), PDFHexString.fromText(options.name))
  if (options.reason) signature.set(PDFName.of('Reason'), PDFHexString.fromText(options.reason))
  if (options.location)
    signature.set(PDFName.of('Location'), PDFHexString.fromText(options.location))
  if (options.contactInfo) {
    signature.set(PDFName.of('ContactInfo'), PDFHexString.fromText(options.contactInfo))
  }
  const signatureRef = context.register(signature)

  const [x, y, width, height] = options.appearance?.rect ?? [0, 0, 0, 0]
  const widget = context.obj({
    Type: 'Annot',
    Subtype: 'Widget',
    FT: 'Sig',
    Rect: [x, y, x + width, y + height],
    V: signatureRef,
    T: PDFHexString.fromText(options.fieldName ?? `Signature${Date.now()}`),
    F: 4,
    P: page.ref
  })
  if (options.appearance?.png && width > 0 && height > 0) {
    const image = await target.embedPng(options.appearance.png)
    const stream = context.formXObject(
      [
        pushGraphicsState(),
        concatTransformationMatrix(width, 0, 0, height, 0, 0),
        drawObject('Img'),
        popGraphicsState()
      ],
      { BBox: [0, 0, width, height], Resources: { XObject: { Img: image.ref } } }
    )
    widget.set(PDFName.of('AP'), context.obj({ N: context.register(stream) }))
  }
  const widgetRef = context.register(widget)
  page.node.addAnnot(widgetRef)
  const acroForm = target.catalog.getOrCreateAcroForm()
  acroForm.addField(widgetRef)
  acroForm.dict.set(PDFName.of('SigFlags'), PDFNumber.of(3))
}

/** Signs `pdf` with the credentials; returns the signed file. */
export async function signPDF(
  pdf: Uint8Array,
  credentials: SigningCredentials,
  options: SignPDFOptions = {}
): Promise<Uint8Array> {
  const loaded = await PDFDocument.load(pdf, { updateMetadata: false })
  await addSignatureField(loaded, options)
  const bytes = await loaded.save({ useObjectStreams: false })
  const text = latin1(bytes)

  const rangeText = `/ByteRange [ 0 /${BYTE_RANGE_PLACEHOLDER} /${BYTE_RANGE_PLACEHOLDER} /${BYTE_RANGE_PLACEHOLDER} ]`
  const rangeAt = text.indexOf(rangeText)
  const contentsAt = text.indexOf(`<${'0'.repeat(SIGNATURE_BYTES * 2)}>`)
  if (rangeAt === -1 || contentsAt === -1)
    throw new Error('Could not place the signature in the PDF')
  const contentsEnd = contentsAt + SIGNATURE_BYTES * 2 + 2
  const ranges = [0, contentsAt, contentsEnd, bytes.length - contentsEnd]
  const filled = `/ByteRange [${ranges.join(' ')}]`.padEnd(rangeText.length, ' ')
  bytes.set(new TextEncoder().encode(filled), rangeAt)

  const md = forge.md.sha256.create()
  md.update(latin1(bytes.subarray(0, contentsAt)))
  md.update(latin1(bytes.subarray(contentsEnd)))
  const cms = cadesDetachedSignature(md.digest().getBytes(), credentials)
  const hex = forge.util.bytesToHex(cms)
  if (hex.length > SIGNATURE_BYTES * 2)
    throw new Error('The certificate chain is too large to embed')
  bytes.set(new TextEncoder().encode(hex), contentsAt + 1)
  return bytes
}

export interface PDFSignatureCheck {
  signer: CertificateSummary
  /** The signature matches the bytes it covers. */
  intact: boolean
  /** It covers the whole file: nothing was appended after signing. */
  coversWholeFile: boolean
}

/** Checks every signature in a PDF against the bytes it covers. */
export function verifyPDFSignatures(pdf: Uint8Array): PDFSignatureCheck[] {
  const text = latin1(pdf)
  const checks: PDFSignatureCheck[] = []
  for (const match of text.matchAll(/\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g)) {
    const [a, b, c, d] = match.slice(1, 5).map(Number)
    const contents = text.slice(a + b, c).replace(/^<|>$/g, '')
    const der = forge.util.hexToBytes(contents.replace(/(00)+$/, ''))
    const md = forge.md.sha256.create()
    md.update(text.slice(a, a + b))
    md.update(text.slice(c, c + d))
    let result: ReturnType<typeof verifyCadesDetached>
    try {
      result = verifyCadesDetached(der, md.digest().getBytes())
    } catch {
      continue
    }
    checks.push({
      signer: summarizeCertificate(result.signer),
      intact: result.digestMatches && result.signatureValid,
      coversWholeFile: c + d === pdf.length
    })
  }
  return checks
}

/** Each page's size in points, for placing a visible signature. */
export async function pdfPageSizes(
  pdf: Uint8Array
): Promise<Array<{ width: number; height: number }>> {
  const loaded = await PDFDocument.load(pdf, { updateMetadata: false })
  return loaded.getPages().map((page) => page.getSize())
}
