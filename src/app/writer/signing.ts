import { useLocalStorage } from '@vueuse/core'
import { fromUint8Array, isValid, toUint8Array } from 'js-base64'
import * as v from 'valibot'

import {
  createSelfSignedCredentials,
  readPKCS12,
  signPDF,
  SigningCredentialsError,
  summarizeCertificate,
  writePKCS12,
  type CertificateSummary,
  type SignPDFOptions
} from '@lawha/core/pdf-sign'

import { appCredentialServices } from '@/app/settings/credentials/app'
import { credentialRef } from '@/app/settings/credentials/reference'

/**
 * The person's signing certificate. Its password-protected PKCS #12 is kept in the platform
 * credential store (the system keychain on desktop), never in settings or on a server; the
 * password is asked for at each signature, and the private key exists only while signing.
 */
const PKCS12_REF = credentialRef('pdf-signing', 'pkcs12')

const summarySchema = v.object({
  subject: v.string(),
  email: v.nullable(v.string()),
  issuer: v.string(),
  selfSigned: v.boolean(),
  notBefore: v.string(),
  notAfter: v.string(),
  fingerprint: v.string()
})

/** What the certificate is, without its key, for the dialog to show. */
const storedSummary = useLocalStorage<string | null>('lawha:signing-certificate', null)

export function signingCertificate(): CertificateSummary | null {
  const raw = storedSummary.value
  if (!raw) return null
  const parsed = v.safeParse(v.pipe(v.string(), v.parseJson(), summarySchema), raw)
  return parsed.success ? parsed.output : null
}

export type SigningOutcome =
  | { status: 'done' }
  | {
      status: 'failed'
      reason: 'wrong-password' | 'no-certificate' | 'invalid' | 'error'
      detail: string
    }

function failure(error: unknown): SigningOutcome {
  if (error instanceof SigningCredentialsError) {
    const reason = error.reason === 'wrong-password' ? 'wrong-password' : 'invalid'
    return { status: 'failed', reason, detail: error.reason }
  }
  return {
    status: 'failed',
    reason: 'error',
    detail: error instanceof Error ? error.message : String(error)
  }
}

async function keep(p12: Uint8Array, summary: CertificateSummary): Promise<void> {
  await appCredentialServices.manager.set(PKCS12_REF, fromUint8Array(p12))
  storedSummary.value = JSON.stringify(summary)
}

/** Makes a self-signed certificate on this device and keeps it under `password`. */
export async function createSigningCertificate(
  name: string,
  email: string,
  password: string
): Promise<SigningOutcome> {
  try {
    const credentials = await createSelfSignedCredentials({ name, email: email || undefined })
    await keep(writePKCS12(credentials, password), summarizeCertificate(credentials.certificate))
    return { status: 'done' }
  } catch (error) {
    return failure(error)
  }
}

/** Imports a .p12 or .pfx, checking its password before keeping it. */
export async function importSigningCertificate(
  bytes: Uint8Array,
  password: string
): Promise<SigningOutcome> {
  try {
    const credentials = readPKCS12(bytes, password)
    await keep(bytes, summarizeCertificate(credentials.certificate))
    return { status: 'done' }
  } catch (error) {
    return failure(error)
  }
}

export async function removeSigningCertificate(): Promise<void> {
  await appCredentialServices.manager.clear(PKCS12_REF)
  storedSummary.value = null
}

/** Signs `pdf` with the kept certificate, opened with `password`. */
export async function signWithCertificate(
  pdf: Uint8Array,
  password: string,
  options: SignPDFOptions
): Promise<{ bytes: Uint8Array } | SigningOutcome> {
  try {
    const stored = await appCredentialServices.resolver.resolve(PKCS12_REF)
    if (!stored || !isValid(stored)) {
      return { status: 'failed', reason: 'no-certificate', detail: '' }
    }
    const credentials = readPKCS12(toUint8Array(stored), password)
    return { bytes: await signPDF(pdf, credentials, options) }
  } catch (error) {
    return failure(error)
  }
}

/** The visible stamp: the visual signature if given, the name, and the signing date. */
export async function signatureStamp(
  lines: string[],
  signature: string | null
): Promise<Uint8Array> {
  const canvas = document.createElement('canvas')
  canvas.width = 720
  canvas.height = 240
  const context = canvas.getContext('2d')
  if (!context) return new Uint8Array()
  context.strokeStyle = '#1a237e'
  context.lineWidth = 3
  context.strokeRect(2, 2, canvas.width - 4, canvas.height - 4)
  let textStart = 24
  if (signature) {
    const image = new Image()
    image.src = signature
    await image.decode().catch(() => undefined)
    const height = 150
    const width = Math.min(320, (image.naturalWidth / Math.max(image.naturalHeight, 1)) * height)
    context.drawImage(image, 20, 45, width, height)
    textStart = width + 44
  }
  context.fillStyle = '#1a237e'
  context.textBaseline = 'top'
  lines.forEach((line, index) => {
    context.font = index === 0 ? 'bold 34px sans-serif' : '26px sans-serif'
    context.fillText(line, textStart, 40 + index * 46, canvas.width - textStart - 20)
  })
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/png')
  })
  return blob ? new Uint8Array(await blob.arrayBuffer()) : new Uint8Array()
}
