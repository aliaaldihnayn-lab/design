import { describe, expect, setDefaultTimeout, test } from 'bun:test'

import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib'
import { toUint8Array } from 'js-base64'
import forge from 'node-forge'

import {
  createSelfSignedCredentials,
  readPKCS12,
  signPDF,
  SigningCredentialsError,
  summarizeCertificate,
  verifyPDFSignatures,
  writePKCS12,
  type SigningCredentials
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

/** A PKCS #12 with an ECDSA P-256 key, password `secret`, made by OpenSSL for this test. */
const ECDSA_P12 = toUint8Array(
  [
    'MIIEDAIBAzCCA8IGCSqGSIb3DQEHAaCCA7MEggOvMIIDqzCCAmIGCSqGSIb3DQEHBqCCAlMwggJPAgEAMIICSAYJKo',
    'ZIhvcNAQcBMFcGCSqGSIb3DQEFDTBKMCkGCSqGSIb3DQEFDDAcBAiEf71AXkKPKQICCAAwDAYIKoZIhvcNAgkFADAd',
    'BglghkgBZQMEASoEEOooBLgJkPJTEHR28DVk61CAggHgcq1jszm9+NvBbWM5rbDFjX/o5433I6jCDM6WjfkXZh+S/J',
    'LJ0i3VaTAVK9tjgu5p3953/2VudgvCNCmNp1mH+v/0ZeUoY3aU+V43xcoMNaZzF5HHiCFEFt5YbVXUlgdHFc1y2k62',
    'styYw4E1eKQwVVsE4UceDjOtyIGa5cRWlpWhnUABIbm+0QWImiJy4l7uLoYX1lT1naoJiqtfLA97VgVmSz+O7JP5nA',
    'Rq1Vs2ZRFhn6ym1dBjRhId1TdXWxPadbDxVlhUVo2mpDaSmpP7l6njQo7n43GRXq59AdkpkdZqVo6m7MQekhqr7vVO',
    'zIGG5rwT7Zbj1UbygzNXmFVw3zCEilhVQs1fAt5o9V1mMe0vkhQb0aUGpsk9EH+azRQ2JB8OxJ8aSrUXEg1GwyZRAl',
    'xiKCmg22WN2XJ7tFcVcp5tbZPQAATw8eps/+/tmi3zgkfLGhXA7NYpfrY+3zLYLoK4iuYCZmrd48mESQlsyQ46rWYZ',
    'DQ1/Gb1vj1S4h18n/u+uymkwKWxr0vyS/XGBe/RBcspJIKG1Ap1GCp2wBqGSvzEAVzRc0Ja3qZ/pvtGePiVZFLJf2D',
    'SFpfkexoRiHWBYKUeNQ7DX5zCjQ1ID9WYAM3zz1gs9C56n1rkH09aPMIIBQQYJKoZIhvcNAQcBoIIBMgSCAS4wggEq',
    'MIIBJgYLKoZIhvcNAQwKAQKgge8wgewwVwYJKoZIhvcNAQUNMEowKQYJKoZIhvcNAQUMMBwECOs8LggVsSKMAgIIAD',
    'AMBggqhkiG9w0CCQUAMB0GCWCGSAFlAwQBKgQQUVIMM6/QB21AFXK5sEi+SgSBkFABO3+XU/MkdMyR7gfZMU9CEsI+',
    'YEoTB9ME2gYAge8xS3xBamdoBMVEjodg0JHK56GniUzunrvH2q/h7TFjxfag/9hRaDW6KJ3hOh3Iezvcz2EE5k1HAW',
    'O/iW0ITtBf1guputRTvrXmzVtreV9HWRNmnZ3RB8K30+gpvjLtOqdU24RGcxD7FFPsn2hiva5LCjElMCMGCSqGSIb3',
    'DQEJFTEWBBSm1AKZjBV9LcO+ybjuLxIM6kXrgDBBMDEwDQYJYIZIAWUDBAIBBQAEIIR9kRB1Gvfl9Hn/416TwvhuO8',
    'uKBbHcWbvbsP1Wk3bmBAhZrBq80x94HwICCAA='
  ].join('')
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

  test('tells a certificate with a key it cannot sign with from one without a key', () => {
    expect(() => readPKCS12(ECDSA_P12, 'secret')).toThrow(
      expect.objectContaining({ reason: 'unsupported-key' })
    )
    expect(() => readPKCS12(ECDSA_P12, 'wrong')).toThrow(
      expect.objectContaining({ reason: 'wrong-password' })
    )
  })

  test('finds a signature whose value ends in a zero byte, as one in 256 do', async () => {
    // A key from a fixed seed and a fixed file, so the same reasons give the same signatures.
    const prng = forge.random.createInstance()
    prng.seedFileSync = (length: number) => 'x'.repeat(length)
    const keys = forge.pki.rsa.generateKeyPair({ bits: 1024, e: 0x10001, prng })
    const certificate = forge.pki.createCertificate()
    certificate.publicKey = keys.publicKey
    certificate.serialNumber = '01'
    certificate.validity.notBefore = new Date('2026-01-01T00:00:00Z')
    certificate.validity.notAfter = new Date('2027-01-01T00:00:00Z')
    certificate.setSubject([{ name: 'commonName', value: 'Fixed' }])
    certificate.setIssuer([{ name: 'commonName', value: 'Fixed' }])
    certificate.sign(keys.privateKey, forge.md.sha256.create())
    const fixed: SigningCredentials = { privateKey: keys.privateKey, certificate, chain: [] }
    const document = await PDFDocument.create({ updateMetadata: false })
    document.addPage([200, 200])
    const pdf = await document.save()
    let endsInZero = 0
    for (let attempt = 0; attempt < 64; attempt += 1) {
      const signed = await signPDF(pdf, fixed, {
        reason: String(attempt),
        date: new Date('2026-06-01T00:00:00Z')
      })
      const signature = certificateSignatureValue(signed)
      if (signature.endsWith('00')) endsInZero += 1
      expect(verifyPDFSignatures(signed)).toEqual([
        expect.objectContaining({ intact: true, coversWholeFile: true })
      ])
    }
    expect(endsInZero).toBeGreaterThan(0)
  })

  test('reports a signature whose CMS is no longer SignedData as broken', async () => {
    const signed = await signPDF(await samplePDF(), await credentials)
    const text = new TextDecoder('latin1').decode(signed)
    // The last byte of the SignedData OID (1.2.840.113549.1.7.2) at the start of /Contents.
    const at = text.lastIndexOf('/Contents <') + '/Contents <'.length + 28
    const tampered = signed.slice()
    tampered[at] = '0'.charCodeAt(0)
    tampered[at + 1] = '3'.charCodeAt(0)
    expect(verifyPDFSignatures(tampered)).toEqual([expect.objectContaining({ intact: false })])
  })
})

/** The hex of the RSA signature value: the last element of the CMS, before the zero padding. */
function certificateSignatureValue(signed: Uint8Array): string {
  const text = new TextDecoder('latin1').decode(signed)
  const hex = text.slice(text.lastIndexOf('/Contents <') + '/Contents <'.length).split('>')[0]
  const der = forge.util.hexToBytes(hex)
  const node = forge.asn1.fromDer(der.slice(0, 4 + (der.charCodeAt(2) << 8) + der.charCodeAt(3)))
  const signedData = childValue(childValue(node, 1), 0)
  const signerInfo = childValue(childValue(signedData, 4), 0)
  const value = childValue(signerInfo, 5).value
  return typeof value === 'string' ? forge.util.bytesToHex(value) : ''
}

function childValue(node: forge.asn1.Asn1, index: number): forge.asn1.Asn1 {
  const child = Array.isArray(node.value) ? node.value[index] : undefined
  if (!child) throw new Error('Unexpected CMS shape')
  return child
}
