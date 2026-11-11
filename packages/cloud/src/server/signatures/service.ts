import {
  signedDownloadPath,
  signingPath,
  type CreateSignatureEnvelopeInput,
  type DeclineSigningInput,
  type SignatureEnvelope,
  type SignatureEventKind,
  type SignDocumentInput,
  type SigningView
} from '#cloud/contract'
import type { CloudActor } from '#cloud/server/auth'
import type { CloudDatabase } from '#cloud/server/db'
import type {
  SignatureEnvelopeTable,
  SignatureEventTable,
  SignatureSignerTable
} from '#cloud/server/db/tables'
import type { TransactionalEmailService } from '#cloud/server/email'
import { hmac } from '@noble/hashes/hmac.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import { fromUint8Array, toUint8Array } from 'js-base64'
import type { Kysely, Selectable } from 'kysely'

import { randomHex } from '@lawha/scene-graph/random'

import { finalSignedPDF } from './final-pdf'
import { sealPDF, type SealCredentials } from './seal'

const SECRET_BYTES = 32
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47]
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46]

export type SignatureServiceOptions = {
  email?: TransactionalEmailService
  publicURL: string
  now?: () => Date
  /** Keys completion emails' download links; the server's auth secret. */
  downloadSecret: string
  /** Seals final PDFs with the server's certificate, when the deployment configures one. */
  seal?: SealCredentials | null
  /** A font for names the standard PDF fonts cannot draw, such as Arabic ones. */
  scriptFont?: Uint8Array | null
}

/** Where a request came from, for the audit trail. */
export type SigningRequestContext = {
  ipAddress: string | null
  userAgent: string | null
}

export type SigningOutcome = 'done' | 'not_found' | 'closed' | 'invalid'

type Envelope = Selectable<SignatureEnvelopeTable>
type Signer = Selectable<SignatureSignerTable>
type Event = Selectable<SignatureEventTable>

const digestOf = (secret: string) => bytesToHex(sha256(utf8ToBytes(secret)))
const hexDigest = (bytes: Uint8Array) => bytesToHex(sha256(bytes))
const iso = (date: Date | null) => (date ? new Date(date).toISOString() : null)
const startsWith = (bytes: Uint8Array, magic: readonly number[]) =>
  magic.every((byte, index) => bytes[index] === byte)

/** Compares two hex digests in time that does not depend on where they differ. */
function sameDigest(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let difference = 0
  for (let i = 0; i < a.length; i += 1) difference |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return difference === 0
}

function envelopeView(envelope: Envelope, signers: Signer[], events: Event[]): SignatureEnvelope {
  return {
    id: envelope.id,
    title: envelope.title,
    message: envelope.message,
    status: envelope.status,
    createdAt: new Date(envelope.createdAt).toISOString(),
    completedAt: iso(envelope.completedAt),
    originalSHA256: envelope.originalSha256,
    finalSHA256: envelope.finalSha256,
    signers: signers.map((signer) => ({
      id: signer.id,
      name: signer.name,
      email: signer.email,
      status: signer.status,
      viewedAt: iso(signer.viewedAt),
      signedAt: iso(signer.signedAt),
      declinedAt: iso(signer.declinedAt),
      declineReason: signer.declineReason
    })),
    events: events.map((event) => ({
      id: event.id,
      kind: event.kind,
      signerId: event.signerId,
      at: new Date(event.createdAt).toISOString(),
      ipAddress: event.ipAddress,
      userAgent: event.userAgent
    }))
  }
}

export function createSignatureService(
  database: Kysely<CloudDatabase>,
  options: SignatureServiceOptions
) {
  const now = options.now ?? (() => new Date())
  const link = (signerId: string, secret: string) =>
    new URL(signingPath(signerId, secret), options.publicURL).href
  const downloadMAC = (envelopeId: string) =>
    bytesToHex(
      hmac(sha256, utf8ToBytes(options.downloadSecret), utf8ToBytes(`signed:${envelopeId}`))
    )
  /** A link straight to the envelope's signed PDF, which anyone sent the completion email holds. */
  const downloadLink = (envelopeId: string) =>
    new URL(signedDownloadPath(`${envelopeId}.${downloadMAC(envelopeId)}`), options.publicURL).href

  async function record(
    executor: Kysely<CloudDatabase>,
    envelopeId: string,
    kind: SignatureEventKind,
    signerId: string | null,
    context: SigningRequestContext
  ) {
    await executor
      .insertInto('signatureEvent')
      .values({
        id: crypto.randomUUID(),
        envelopeId,
        signerId,
        kind,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        createdAt: now()
      })
      .execute()
  }

  async function load(envelopeId: string) {
    const envelope = await database
      .selectFrom('signatureEnvelope')
      .selectAll()
      .where('id', '=', envelopeId)
      .executeTakeFirst()
    if (!envelope) return null
    const signers = await database
      .selectFrom('signatureSigner')
      .selectAll()
      .where('envelopeId', '=', envelopeId)
      .orderBy('position')
      .execute()
    const events = await database
      .selectFrom('signatureEvent')
      .selectAll()
      .where('envelopeId', '=', envelopeId)
      .orderBy('createdAt')
      .execute()
    return { envelope, signers, events }
  }

  /** The signer a link names, when its secret matches. */
  async function signerFor(signerId: string, secret: string) {
    const signer = await database
      .selectFrom('signatureSigner')
      .selectAll()
      .where('id', '=', signerId)
      .executeTakeFirst()
    if (!signer || !sameDigest(signer.secretDigest, digestOf(secret))) return null
    return signer
  }

  /** Makes the final PDF once every signer has signed, and tells everyone. */
  async function completeIfSigned(envelopeId: string, context: SigningRequestContext) {
    const loaded = await load(envelopeId)
    if (loaded?.envelope.status !== 'sent') return
    if (!loaded.signers.every((signer) => signer.status === 'signed')) return
    const names = new Map(loaded.signers.map((signer) => [signer.id, signer.email]))
    const audited = await finalSignedPDF({
      original: loaded.envelope.originalPdf,
      title: loaded.envelope.title,
      envelopeId,
      originalSHA256: loaded.envelope.originalSha256,
      signers: loaded.signers.map((signer) => ({
        name: signer.name,
        email: signer.email,
        signedAt: new Date(signer.signedAt ?? now()),
        ipAddress:
          loaded.events.find((event) => event.signerId === signer.id && event.kind === 'signed')
            ?.ipAddress ?? null,
        signaturePng: signer.signaturePng ?? new Uint8Array()
      })),
      events: [
        ...loaded.events.map((event) => ({
          at: new Date(event.createdAt),
          kind: event.kind,
          who: event.signerId ? (names.get(event.signerId) ?? '') : loaded.envelope.senderEmail,
          ipAddress: event.ipAddress
        })),
        { at: now(), kind: 'completed', who: 'Lawha Cloud', ipAddress: null }
      ],
      scriptFont: options.scriptFont
    })
    const final = options.seal
      ? await sealPDF(audited, options.seal, {
          name: 'Lawha Cloud',
          reason: `Signed by every signer of envelope ${envelopeId}`,
          date: now()
        })
      : audited
    await database.transaction().execute(async (transaction) => {
      const updated = await transaction
        .updateTable('signatureEnvelope')
        .set({
          status: 'completed',
          finalPdf: final,
          finalSha256: hexDigest(final),
          completedAt: now()
        })
        .where('id', '=', envelopeId)
        .where('status', '=', 'sent')
        .executeTakeFirst()
      if (!updated.numUpdatedRows) return
      await record(transaction, envelopeId, 'completed', null, context)
      const recipients = [
        loaded.envelope.senderEmail,
        ...loaded.signers.map((signer) => signer.email)
      ]
      for (const recipientEmail of new Set(recipients)) {
        await options.email?.enqueue(
          {
            idempotencyKey: `signature-completed/${envelopeId}/${recipientEmail}`,
            kind: 'signature-completed',
            recipientEmail,
            payload: {
              documentName: loaded.envelope.title,
              actionURL: downloadLink(envelopeId)
            }
          },
          transaction
        )
      }
    })
  }

  return {
    /** Sends a PDF for signature: stores it, and emails each signer their private link. */
    async create(
      actor: CloudActor,
      input: CreateSignatureEnvelopeInput,
      context: SigningRequestContext
    ): Promise<SignatureEnvelope | 'invalid'> {
      const pdf = toUint8Array(input.pdf)
      if (!startsWith(pdf, PDF_MAGIC)) return 'invalid'
      const envelopeId = crypto.randomUUID()
      await database.transaction().execute(async (transaction) => {
        await transaction
          .insertInto('signatureEnvelope')
          .values({
            id: envelopeId,
            ownerId: actor.userId,
            senderName: actor.name || actor.email,
            senderEmail: actor.email,
            title: input.title,
            message: input.message,
            status: 'sent',
            originalPdf: pdf,
            originalSha256: hexDigest(pdf),
            finalPdf: null,
            finalSha256: null,
            createdAt: now()
          })
          .execute()
        await record(transaction, envelopeId, 'created', null, context)
        for (const [position, signer] of input.signers.entries()) {
          const id = crypto.randomUUID()
          const secret = randomHex(SECRET_BYTES)
          await transaction
            .insertInto('signatureSigner')
            .values({
              id,
              envelopeId,
              position,
              name: signer.name,
              email: signer.email,
              secretDigest: digestOf(secret),
              status: 'pending',
              signaturePng: null,
              declineReason: null
            })
            .execute()
          await record(transaction, envelopeId, 'sent', id, context)
          await options.email?.enqueue(
            {
              idempotencyKey: `signature-request/${id}`,
              kind: 'signature-request',
              recipientEmail: signer.email,
              payload: {
                senderName: actor.name || actor.email,
                documentName: input.title,
                message: input.message,
                actionURL: link(id, secret)
              }
            },
            transaction
          )
        }
      })
      const loaded = await load(envelopeId)
      if (!loaded) throw new Error('The envelope was not stored')
      return envelopeView(loaded.envelope, loaded.signers, loaded.events)
    },

    async list(actor: CloudActor): Promise<SignatureEnvelope[]> {
      const rows = await database
        .selectFrom('signatureEnvelope')
        .select('id')
        .where('ownerId', '=', actor.userId)
        .orderBy('createdAt', 'desc')
        .limit(100)
        .execute()
      const envelopes: SignatureEnvelope[] = []
      for (const row of rows) {
        const loaded = await load(row.id)
        if (loaded) envelopes.push(envelopeView(loaded.envelope, loaded.signers, loaded.events))
      }
      return envelopes
    },

    async get(actor: CloudActor, envelopeId: string): Promise<SignatureEnvelope | null> {
      const loaded = await load(envelopeId)
      if (loaded?.envelope.ownerId !== actor.userId) return null
      return envelopeView(loaded.envelope, loaded.signers, loaded.events)
    },

    /** The final signed PDF, or the PDF as sent while signatures are pending. */
    async pdf(actor: CloudActor, envelopeId: string) {
      const envelope = await database
        .selectFrom('signatureEnvelope')
        .select(['ownerId', 'originalPdf', 'finalPdf', 'title'])
        .where('id', '=', envelopeId)
        .executeTakeFirst()
      if (envelope?.ownerId !== actor.userId) return null
      return {
        bytes: envelope.finalPdf ?? envelope.originalPdf,
        signed: envelope.finalPdf !== null,
        title: envelope.title
      }
    },

    /** The signed PDF a completion email's download token opens. */
    async download(token: string) {
      const [envelopeId = '', mac = ''] = token.split('.')
      if (!sameDigest(mac, downloadMAC(envelopeId))) return null
      const envelope = await database
        .selectFrom('signatureEnvelope')
        .select(['finalPdf', 'title'])
        .where('id', '=', envelopeId)
        .where('status', '=', 'completed')
        .executeTakeFirst()
      return envelope?.finalPdf ? { bytes: envelope.finalPdf, title: envelope.title } : null
    },

    async void(actor: CloudActor, envelopeId: string, context: SigningRequestContext) {
      const updated = await database
        .updateTable('signatureEnvelope')
        .set({ status: 'voided' })
        .where('id', '=', envelopeId)
        .where('ownerId', '=', actor.userId)
        .where('status', '=', 'sent')
        .executeTakeFirst()
      if (!updated.numUpdatedRows) return false
      await record(database, envelopeId, 'voided', null, context)
      return true
    },

    /** What a signer's link shows; the first opening is recorded as viewed. */
    async view(
      signerId: string,
      secret: string,
      context: SigningRequestContext
    ): Promise<SigningView | null> {
      const signer = await signerFor(signerId, secret)
      if (!signer) return null
      const envelope = await database
        .selectFrom('signatureEnvelope')
        .select(['title', 'message', 'senderName', 'status', 'originalPdf'])
        .where('id', '=', signer.envelopeId)
        .executeTakeFirstOrThrow()
      let status = signer.status
      if (status === 'pending' && envelope.status === 'sent') {
        await database
          .updateTable('signatureSigner')
          .set({ status: 'viewed', viewedAt: now() })
          .where('id', '=', signer.id)
          .execute()
        await record(database, signer.envelopeId, 'viewed', signer.id, context)
        status = 'viewed'
      }
      return {
        title: envelope.title,
        message: envelope.message,
        senderName: envelope.senderName,
        signerName: signer.name,
        signerStatus: status,
        envelopeStatus: envelope.status,
        pdf: fromUint8Array(envelope.originalPdf)
      }
    },

    async sign(
      signerId: string,
      input: SignDocumentInput,
      context: SigningRequestContext
    ): Promise<SigningOutcome> {
      const signer = await signerFor(signerId, input.secret)
      if (!signer) return 'not_found'
      const png = toUint8Array(input.signature)
      if (!startsWith(png, PNG_MAGIC)) return 'invalid'
      const updated = await database
        .updateTable('signatureSigner')
        .set({ status: 'signed', signaturePng: png, signedAt: now() })
        .where('id', '=', signer.id)
        .where('status', 'in', ['pending', 'viewed'])
        .where((builder) =>
          builder.exists(
            builder
              .selectFrom('signatureEnvelope')
              .select('id')
              .where('id', '=', signer.envelopeId)
              .where('status', '=', 'sent')
          )
        )
        .executeTakeFirst()
      if (!updated.numUpdatedRows) return 'closed'
      await record(database, signer.envelopeId, 'signed', signer.id, context)
      await completeIfSigned(signer.envelopeId, context)
      return 'done'
    },

    async decline(
      signerId: string,
      input: DeclineSigningInput,
      context: SigningRequestContext
    ): Promise<SigningOutcome> {
      const signer = await signerFor(signerId, input.secret)
      if (!signer) return 'not_found'
      const updated = await database
        .updateTable('signatureSigner')
        .set({ status: 'declined', declinedAt: now(), declineReason: input.reason || null })
        .where('id', '=', signer.id)
        .where('status', 'in', ['pending', 'viewed'])
        .executeTakeFirst()
      if (!updated.numUpdatedRows) return 'closed'
      await database
        .updateTable('signatureEnvelope')
        .set({ status: 'declined' })
        .where('id', '=', signer.envelopeId)
        .where('status', '=', 'sent')
        .execute()
      await record(database, signer.envelopeId, 'declined', signer.id, context)
      return 'done'
    }
  }
}

export type SignatureService = ReturnType<typeof createSignatureService>
