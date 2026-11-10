import forge from 'node-forge'

/**
 * Signing credentials: a certificate with its private key, from a PKCS #12 file (.p12, .pfx) the
 * person imports or one generated on this device. Keys stay in memory only while signing; what
 * is kept is the password-protected PKCS #12, in the platform credential store.
 */
export interface SigningCredentials {
  privateKey: forge.pki.rsa.PrivateKey
  certificate: forge.pki.Certificate
  /** Intermediate certificates to embed, signer first. */
  chain: forge.pki.Certificate[]
}

export interface CertificateSummary {
  subject: string
  email: string | null
  issuer: string
  selfSigned: boolean
  notBefore: string
  notAfter: string
  /** SHA-256 of the certificate, hex, to tell certificates apart. */
  fingerprint: string
}

export class SigningCredentialsError extends Error {
  override name = 'SigningCredentialsError'

  constructor(readonly reason: 'wrong-password' | 'no-key' | 'unsupported-key' | 'invalid') {
    super(reason)
  }
}

const bytesToBinary = (bytes: Uint8Array) => forge.util.binary.raw.encode(bytes)
const binaryToBytes = (binary: string) => forge.util.binary.raw.decode(binary)

function attribute(certificate: forge.pki.Certificate, name: string, from: 'subject' | 'issuer') {
  const field = certificate[from].getField(name)
  const value: unknown = field?.value
  if (typeof value !== 'string') return null
  // forge hands UTF8String values back as their UTF-8 bytes.
  return field.valueTagClass === forge.asn1.Type.UTF8 ? forge.util.decodeUtf8(value) : value
}

export function summarizeCertificate(given: forge.pki.Certificate): CertificateSummary {
  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(given)).getBytes()
  // Read back from its encoding, where every text value is in the form it was saved in.
  const certificate = forge.pki.certificateFromAsn1(forge.asn1.fromDer(der))
  const subject = attribute(certificate, 'CN', 'subject') ?? ''
  const issuer = attribute(certificate, 'CN', 'issuer') ?? ''
  return {
    subject,
    email: attribute(certificate, 'E', 'subject'),
    issuer,
    selfSigned: certificate.isIssuer(certificate),
    notBefore: certificate.validity.notBefore.toISOString(),
    notAfter: certificate.validity.notAfter.toISOString(),
    fingerprint: forge.md.sha256.create().update(der).digest().toHex()
  }
}

/** Opens a PKCS #12 file with its password. */
export function readPKCS12(bytes: Uint8Array, password: string): SigningCredentials {
  let p12: forge.pkcs12.Pkcs12Pfx
  try {
    const asn1 = forge.asn1.fromDer(bytesToBinary(bytes))
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, password)
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    throw new SigningCredentialsError(/password|MAC/i.test(message) ? 'wrong-password' : 'invalid')
  }
  const keyBags = [
    ...(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[
      forge.pki.oids.pkcs8ShroudedKeyBag
    ] ?? []),
    ...(p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ?? [])
  ]
  const key = keyBags.find((bag) => bag.key)?.key
  if (!key) throw new SigningCredentialsError('no-key')
  if (!('n' in key)) throw new SigningCredentialsError('unsupported-key')
  const certificates = (
    p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? []
  ).flatMap((bag) => (bag.cert ? [bag.cert] : []))
  const publicKey = forge.pki.setRsaPublicKey(key.n, key.e)
  const matches = (certificate: forge.pki.Certificate) => {
    const candidate = certificate.publicKey
    return 'n' in candidate && candidate.n.equals(publicKey.n)
  }
  const certificate = certificates.find(matches)
  if (!certificate) throw new SigningCredentialsError('no-key')
  return {
    privateKey: key,
    certificate,
    chain: certificates.filter((candidate) => candidate !== certificate)
  }
}

/** Writes credentials as a PKCS #12 file protected by `password` (AES-256). */
export function writePKCS12(credentials: SigningCredentials, password: string): Uint8Array {
  const p12 = forge.pkcs12.toPkcs12Asn1(
    credentials.privateKey,
    [credentials.certificate, ...credentials.chain],
    password,
    { algorithm: 'aes256', friendlyName: 'Lawha signing' }
  )
  return binaryToBytes(forge.asn1.toDer(p12).getBytes())
}

export interface SelfSignedOptions {
  name: string
  email?: string
  organization?: string
  /** How long the certificate is valid; three years by default. */
  years?: number
  /** Overrides the clock, for tests. */
  now?: Date
}

function randomSerial(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  bytes[0] &= 0x7f // A positive serial number.
  return forge.util.bytesToHex(bytesToBinary(bytes))
}

/**
 * A self-signed signing certificate made on this device: an RSA-2048 key from WebCrypto, and a
 * certificate for digital signatures and non-repudiation, as PDF readers expect of a signer.
 */
export async function createSelfSignedCredentials(
  options: SelfSignedOptions
): Promise<SigningCredentials> {
  const pair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256'
    },
    true,
    ['sign', 'verify']
  )
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey))
  const privateInfo = forge.asn1.fromDer(bytesToBinary(pkcs8))
  const privateKey = forge.pki.privateKeyFromAsn1(privateInfo)
  const certificate = forge.pki.createCertificate()
  certificate.publicKey = forge.pki.setRsaPublicKey(privateKey.n, privateKey.e)
  certificate.serialNumber = randomSerial()
  const now = options.now ?? new Date()
  certificate.validity.notBefore = new Date(now.getTime() - 60_000)
  const until = new Date(now)
  until.setUTCFullYear(until.getUTCFullYear() + (options.years ?? 3))
  certificate.validity.notAfter = until
  // UTF8String, so Arabic names encode as they are written.
  const utf8: number = forge.asn1.Type.UTF8
  const subject: forge.pki.CertificateField[] = [
    { name: 'commonName', value: options.name, valueTagClass: utf8 }
  ]
  if (options.organization) {
    subject.push({
      name: 'organizationName',
      value: options.organization,
      valueTagClass: utf8
    })
  }
  if (options.email) subject.push({ name: 'emailAddress', value: options.email })
  certificate.setSubject(subject)
  certificate.setIssuer(subject)
  certificate.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, nonRepudiation: true },
    { name: 'extKeyUsage', emailProtection: true },
    { name: 'subjectKeyIdentifier' }
  ])
  certificate.sign(privateKey, forge.md.sha256.create())
  return { privateKey, certificate, chain: [] }
}
