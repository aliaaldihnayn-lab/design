import forge from 'node-forge'

import type { SigningCredentials } from './credentials'

/**
 * A detached CAdES signature (CMS SignedData) over a PDF's signed byte ranges, as PAdES
 * baseline B-B requires: SHA-256, the signer's certificate embedded, and the signed attributes
 * content-type, message-digest and signing-certificate-v2. The signing time goes in the PDF's
 * signature dictionary, as PAdES asks, not in the CMS.
 */

const { asn1 } = forge
const { Class, Type } = asn1

const OID = {
  data: '1.2.840.113549.1.7.1',
  signedData: '1.2.840.113549.1.7.2',
  contentType: '1.2.840.113549.1.9.3',
  messageDigest: '1.2.840.113549.1.9.4',
  signingCertificateV2: '1.2.840.113549.1.9.16.2.47',
  sha256: '2.16.840.1.101.3.4.2.1',
  rsaEncryption: '1.2.840.113549.1.1.1'
} as const

const oid = (value: string) =>
  asn1.create(Class.UNIVERSAL, Type.OID, false, asn1.oidToDer(value).getBytes())
const seq = (items: forge.asn1.Asn1[]) => asn1.create(Class.UNIVERSAL, Type.SEQUENCE, true, items)
const set = (items: forge.asn1.Asn1[]) => asn1.create(Class.UNIVERSAL, Type.SET, true, items)
const octets = (bytes: string) => asn1.create(Class.UNIVERSAL, Type.OCTETSTRING, false, bytes)
const integer = (value: number) =>
  asn1.create(Class.UNIVERSAL, Type.INTEGER, false, asn1.integerToDer(value).getBytes())
const nil = () => asn1.create(Class.UNIVERSAL, Type.NULL, false, '')
const sha256Algorithm = () => seq([oid(OID.sha256), nil()])

function attribute(type: string, value: forge.asn1.Asn1) {
  return seq([oid(type), set([value])])
}

function certificateDer(certificate: forge.pki.Certificate): string {
  return asn1.toDer(forge.pki.certificateToAsn1(certificate)).getBytes()
}

/** IssuerAndSerialNumber of a certificate, taken from its own encoding. */
function issuerAndSerial(certificate: forge.pki.Certificate): forge.asn1.Asn1 {
  const tbs = forge.pki.certificateToAsn1(certificate).value[0]
  if (typeof tbs === 'string' || !Array.isArray(tbs.value))
    throw new Error('Unreadable certificate')
  // tbsCertificate: [0] version, serialNumber, signature, issuer, ...
  const fields = tbs.value
  const offset = fields[0].tagClass === Class.CONTEXT_SPECIFIC ? 1 : 0
  return seq([fields[offset + 2], fields[offset]])
}

/** CMS signed data over `digest` (raw SHA-256 bytes of the signed content), DER-encoded. */
export function cadesDetachedSignature(digest: string, credentials: SigningCredentials): string {
  const { certificate, chain, privateKey } = credentials
  const certHash = forge.md.sha256.create().update(certificateDer(certificate)).digest().getBytes()
  // ESSCertIDv2 with the default SHA-256 algorithm left out, as DER requires.
  const signingCertificate = seq([seq([seq([octets(certHash)])])])
  const attributes = [
    attribute(OID.contentType, oid(OID.data)),
    attribute(OID.messageDigest, octets(digest)),
    attribute(OID.signingCertificateV2, signingCertificate)
  ]
  // The signature covers the attributes encoded as a SET, then stored as [0] IMPLICIT.
  const signedAttributes = asn1.toDer(set(attributes)).getBytes()
  const md = forge.md.sha256.create().update(signedAttributes)
  const signature = privateKey.sign(md)
  const signerInfo = seq([
    integer(1),
    issuerAndSerial(certificate),
    sha256Algorithm(),
    asn1.create(Class.CONTEXT_SPECIFIC, 0, true, attributes),
    seq([oid(OID.rsaEncryption), nil()]),
    octets(signature)
  ])
  const signedData = seq([
    integer(1),
    set([sha256Algorithm()]),
    seq([oid(OID.data)]),
    asn1.create(
      Class.CONTEXT_SPECIFIC,
      0,
      true,
      [certificate, ...chain].map((cert) => forge.pki.certificateToAsn1(cert))
    ),
    set([signerInfo])
  ])
  const contentInfo = seq([
    oid(OID.signedData),
    asn1.create(Class.CONTEXT_SPECIFIC, 0, true, [signedData])
  ])
  return asn1.toDer(contentInfo).getBytes()
}

export interface CMSCheck {
  /** The signed attributes' message digest matches the content. */
  digestMatches: boolean
  /** The signature over the signed attributes verifies with the embedded certificate. */
  signatureValid: boolean
  signer: forge.pki.Certificate
}

/** Checks a detached CMS signature made by `cadesDetachedSignature` against a content digest. */
export function verifyCadesDetached(der: string, digest: string): CMSCheck {
  const contentInfo = asn1.fromDer(der)
  const signedData = childAt(childAt(contentInfo, 1), 0)
  const certificates = childAt(signedData, 3)
  const signerInfos = childAt(signedData, 4)
  const signer = forge.pki.certificateFromAsn1(childAt(certificates, 0))
  const signerInfo = childAt(signerInfos, 0)
  const signedAttributes = childAt(signerInfo, 3)
  const attributes = Array.isArray(signedAttributes.value) ? signedAttributes.value : []
  const digestAttribute = attributes.find(
    (attr) => asn1.derToOid(childAt(attr, 0).value as string) === OID.messageDigest
  )
  const stored = digestAttribute ? (childAt(childAt(digestAttribute, 1), 0).value as string) : ''
  const encoded = asn1.toDer(set(attributes)).getBytes()
  const md = forge.md.sha256.create().update(encoded)
  const signature = childAt(signerInfo, 5).value as string
  const publicKey = signer.publicKey as forge.pki.rsa.PublicKey
  let signatureValid: boolean
  try {
    signatureValid = publicKey.verify(md.digest().getBytes(), signature)
  } catch {
    signatureValid = false
  }
  return { digestMatches: stored === digest, signatureValid, signer }
}

function childAt(node: forge.asn1.Asn1, index: number): forge.asn1.Asn1 {
  const child = Array.isArray(node.value) ? node.value[index] : undefined
  if (!child) throw new Error('Malformed CMS structure')
  return child
}
