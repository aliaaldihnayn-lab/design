import { PDFArray, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFString } from '@cantoo/pdf-lib'
import { toUint8Array } from 'js-base64'
import forge from 'node-forge'

/**
 * The server's seal on a completed envelope's final PDF: an invisible PDF signature
 * (`adbe.pkcs7.detached`) made with the certificate and key the deployment configures
 * (`signatures.seal`), appended as an incremental update, so a reader shows the final document
 * as signed by this server and any later change as tampering.
 */

const OID = {
  shroudedKeyBag: '1.2.840.113549.1.12.10.1.2',
  keyBag: '1.2.840.113549.1.12.10.1.1',
  certBag: '1.2.840.113549.1.12.10.1.3',
  sha256: '2.16.840.1.101.3.4.2.1',
  contentType: '1.2.840.113549.1.9.3',
  data: '1.2.840.113549.1.7.1',
  messageDigest: '1.2.840.113549.1.9.4'
} as const

const CONTENTS_BYTES = 16_384
const PLACEHOLDER = '**********'

export interface SealCredentials {
  certificate: forge.pki.Certificate
  chain: forge.pki.Certificate[]
  key: forge.pki.rsa.PrivateKey
}

/** Reads the configured base64 PKCS #12 with its password. */
export function readSealCredentials(pkcs12Base64: string, password = ''): SealCredentials {
  const der = forge.util.binary.raw.encode(toUint8Array(pkcs12Base64))
  const p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(der), password)
  const keyBag =
    p12.getBags({ bagType: OID.shroudedKeyBag })[OID.shroudedKeyBag]?.[0] ??
    p12.getBags({ bagType: OID.keyBag })[OID.keyBag]?.[0]
  const certificates = (p12.getBags({ bagType: OID.certBag })[OID.certBag] ?? []).flatMap(
    (bag: forge.pkcs12.Bag) => (bag.cert ? [bag.cert] : [])
  )
  const key = keyBag?.key
  const [certificate, ...chain] = certificates
  if (!key || !certificate || !('n' in key))
    throw new Error('The seal has no RSA key or certificate')
  return { certificate, chain, key }
}

const latin1 = (bytes: Uint8Array) => {
  let out = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    out += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return out
}

export async function sealPDF(
  pdf: Uint8Array,
  credentials: SealCredentials,
  options: { name: string; reason: string; date: Date }
): Promise<Uint8Array> {
  const loaded = await PDFDocument.load(pdf, { updateMetadata: false, forIncrementalUpdate: true })
  const { context } = loaded
  const snapshot = context.snapshot
  if (!snapshot) throw new Error('The PDF could not be opened for an update')
  const range = PDFArray.withContext(context)
  range.push(PDFNumber.of(0))
  for (let i = 0; i < 3; i += 1) range.push(PDFName.of(PLACEHOLDER))
  const signature = context.register(
    context.obj({
      Type: 'Sig',
      Filter: 'Adobe.PPKLite',
      SubFilter: 'adbe.pkcs7.detached',
      ByteRange: range,
      Contents: PDFHexString.of('0'.repeat(CONTENTS_BYTES * 2)),
      M: PDFString.fromDate(options.date),
      Name: PDFHexString.fromText(options.name),
      Reason: PDFHexString.fromText(options.reason)
    })
  )
  const page = loaded.getPages().at(-1)
  if (!page) throw new Error('The PDF has no pages')
  const widget = context.register(
    context.obj({
      Type: 'Annot',
      Subtype: 'Widget',
      FT: 'Sig',
      Rect: [0, 0, 0, 0],
      V: signature,
      T: PDFHexString.fromText('Seal'),
      F: 4,
      P: page.ref
    })
  )
  page.node.addAnnot(widget)
  snapshot.markRefForSave(page.ref)
  const form = loaded.catalog.getOrCreateAcroForm()
  form.addField(widget)
  form.dict.set(PDFName.of('SigFlags'), PDFNumber.of(3))
  snapshot.markObjForSave(form.dict)
  snapshot.markObjForSave(loaded.catalog)
  const bytes = await loaded.commit({ useObjectStreams: false })

  const text = latin1(bytes)
  const rangeText = `/ByteRange [ 0 /${PLACEHOLDER} /${PLACEHOLDER} /${PLACEHOLDER} ]`
  const rangeAt = text.lastIndexOf(rangeText)
  const contentsAt = text.lastIndexOf(`<${'0'.repeat(CONTENTS_BYTES * 2)}>`)
  if (rangeAt < pdf.length || contentsAt < pdf.length) throw new Error('Could not place the seal')
  const contentsEnd = contentsAt + CONTENTS_BYTES * 2 + 2
  const filled = `/ByteRange [0 ${contentsAt} ${contentsEnd} ${bytes.length - contentsEnd}]`
  bytes.set(new TextEncoder().encode(filled.padEnd(rangeText.length, ' ')), rangeAt)

  const signed = forge.pkcs7.createSignedData()
  signed.content = forge.util.createBuffer(
    latin1(bytes.subarray(0, contentsAt)) + latin1(bytes.subarray(contentsEnd))
  )
  for (const certificate of [credentials.certificate, ...credentials.chain]) {
    signed.addCertificate(certificate)
  }
  signed.addSigner({
    key: credentials.key,
    certificate: credentials.certificate,
    digestAlgorithm: OID.sha256,
    // The signing time is the signature dictionary's `/M`.
    authenticatedAttributes: [
      { type: OID.contentType, value: OID.data },
      { type: OID.messageDigest }
    ]
  })
  signed.sign({ detached: true })
  const hex = forge.util.bytesToHex(forge.asn1.toDer(signed.toAsn1()).getBytes())
  if (hex.length > CONTENTS_BYTES * 2) throw new Error('The seal certificate chain is too large')
  bytes.set(new TextEncoder().encode(hex), contentsAt + 1)
  return bytes
}
