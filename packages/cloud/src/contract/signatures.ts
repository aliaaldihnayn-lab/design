import { isValid } from 'js-base64'
import * as v from 'valibot'

/**
 * Sending documents for signature: the sender uploads a PDF and names the signers, each signer
 * gets an email with a private link, reads the PDF and signs with a drawn or typed signature,
 * and once everyone has signed the server makes the final PDF with an audit trail.
 */

/** A PDF up to 20 MB, Base64-encoded. */
const MAXIMUM_PDF_BASE64 = Math.ceil((20 * 1024 * 1024 * 4) / 3)
/** A signature image up to 512 KB. */
const MAXIMUM_SIGNATURE_BASE64 = Math.ceil((512 * 1024 * 4) / 3)

const base64Schema = (maximum: number) =>
  v.pipe(
    v.string(),
    v.maxLength(maximum),
    v.check((value) => isValid(value), 'Expected Base64')
  )

const idSchema = v.pipe(v.string(), v.uuid())
const timestampSchema = v.pipe(v.string(), v.isoTimestamp())

export const signatureEnvelopeStatusSchema = v.picklist(['sent', 'completed', 'declined', 'voided'])
export const signatureSignerStatusSchema = v.picklist(['pending', 'viewed', 'signed', 'declined'])
export const signatureEventKindSchema = v.picklist([
  'created',
  'sent',
  'viewed',
  'signed',
  'declined',
  'completed',
  'voided'
])

export const createSignatureEnvelopeSchema = v.object({
  title: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(200)),
  message: v.optional(v.pipe(v.string(), v.maxLength(2000)), ''),
  pdf: base64Schema(MAXIMUM_PDF_BASE64),
  signers: v.pipe(
    v.array(
      v.object({
        name: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(120)),
        email: v.pipe(v.string(), v.trim(), v.email(), v.maxLength(254))
      })
    ),
    v.minLength(1),
    v.maxLength(20)
  )
})

export const signatureSignerSchema = v.object({
  id: idSchema,
  name: v.string(),
  email: v.string(),
  status: signatureSignerStatusSchema,
  viewedAt: v.nullable(timestampSchema),
  signedAt: v.nullable(timestampSchema),
  declinedAt: v.nullable(timestampSchema),
  declineReason: v.nullable(v.string())
})

export const signatureEventSchema = v.object({
  id: idSchema,
  kind: signatureEventKindSchema,
  signerId: v.nullable(idSchema),
  at: timestampSchema,
  ipAddress: v.nullable(v.string()),
  userAgent: v.nullable(v.string())
})

export const signatureEnvelopeSchema = v.object({
  id: idSchema,
  title: v.string(),
  message: v.string(),
  status: signatureEnvelopeStatusSchema,
  createdAt: timestampSchema,
  completedAt: v.nullable(timestampSchema),
  /** SHA-256 of the PDF as sent, hex. */
  originalSHA256: v.string(),
  /** SHA-256 of the final signed PDF, hex, once everyone has signed. */
  finalSHA256: v.nullable(v.string()),
  signers: v.array(signatureSignerSchema),
  events: v.array(signatureEventSchema)
})

/** The secret from a signer's link, which travels in its fragment and then in request bodies. */
export const signingSecretSchema = v.object({
  secret: v.pipe(v.string(), v.regex(/^[0-9a-f]{64}$/))
})

export const signingViewSchema = v.object({
  title: v.string(),
  message: v.string(),
  senderName: v.string(),
  signerName: v.string(),
  signerStatus: signatureSignerStatusSchema,
  envelopeStatus: signatureEnvelopeStatusSchema,
  pdf: v.string()
})

export const signDocumentSchema = v.object({
  ...signingSecretSchema.entries,
  /** The drawn or typed signature as a PNG. */
  signature: base64Schema(MAXIMUM_SIGNATURE_BASE64),
  agree: v.literal(true)
})

export const declineSigningSchema = v.object({
  ...signingSecretSchema.entries,
  reason: v.optional(v.pipe(v.string(), v.maxLength(500)), '')
})

/** A completed envelope's download token, from the link in its completion email. */
export const signedDownloadSchema = v.object({
  token: v.pipe(v.string(), v.regex(/^[0-9a-f-]{36}\.[0-9a-f]{64}$/))
})

/** The signed PDF a download token opens. */
export const signedDownloadResponseSchema = v.object({
  title: v.string(),
  pdf: v.string()
})

export type SignatureEnvelopeStatus = v.InferOutput<typeof signatureEnvelopeStatusSchema>
export type SignatureSignerStatus = v.InferOutput<typeof signatureSignerStatusSchema>
export type SignatureEventKind = v.InferOutput<typeof signatureEventKindSchema>
export type CreateSignatureEnvelopeInput = v.InferOutput<typeof createSignatureEnvelopeSchema>
export type SignatureSigner = v.InferOutput<typeof signatureSignerSchema>
export type SignatureEvent = v.InferOutput<typeof signatureEventSchema>
export type SignatureEnvelope = v.InferOutput<typeof signatureEnvelopeSchema>
export type SigningView = v.InferOutput<typeof signingViewSchema>
export type SignDocumentInput = v.InferOutput<typeof signDocumentSchema>
export type DeclineSigningInput = v.InferOutput<typeof declineSigningSchema>

export type SignedDownloadResponse = v.InferOutput<typeof signedDownloadResponseSchema>

/** Where a completion email's link downloads the signed PDF; the token travels in the fragment. */
export function signedDownloadPath(token: string): string {
  return `/sign/download#${token}`
}

/** Where a signer opens their link, relative to the server's public URL. */
export function signingPath(signerId: string, secret: string): string {
  return `/sign/${signerId}#${secret}`
}
