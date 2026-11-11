import { describe, expect, test } from 'bun:test'

import { createCloudTestDatabase } from '#cloud-tests/helpers/database'
import type { EnqueueTransactionalEmailInput, TransactionalEmailService } from '#cloud/server/email'
import { createPublicSigningRoutes, createSignatureService } from '#cloud/server/signatures'
import { PDFDocument } from '@cantoo/pdf-lib'
import { Hono } from 'hono'
import { fromUint8Array } from 'js-base64'

/** A 1×1 PNG, standing in for a drawn signature. */
const SIGNATURE =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='

const owner = { userId: crypto.randomUUID(), email: 'sender@example.com', name: 'Sender' }
const context = { ipAddress: '203.0.113.7', userAgent: 'test' }

async function samplePDF(): Promise<string> {
  const pdf = await PDFDocument.create()
  pdf.addPage([595, 842])
  return fromUint8Array(await pdf.save())
}

/** An email outbox that keeps what it was asked to send. */
function recordingEmail() {
  const sent: Array<EnqueueTransactionalEmailInput<'signature-request' | 'signature-completed'>> =
    []
  const email: TransactionalEmailService = {
    enqueue: async (input) => {
      if (input.kind === 'signature-request' || input.kind === 'signature-completed') {
        sent.push(
          input as EnqueueTransactionalEmailInput<'signature-request' | 'signature-completed'>
        )
      }
      return crypto.randomUUID()
    },
    deliverPending: async () => ({ claimed: 0, accepted: 0, retrying: 0, failed: 0, suppressed: 0 })
  }
  return { email, sent }
}

/** The signer id and secret from a signing link, as the signing page reads them. */
function linkParts(url: string) {
  const parsed = new URL(url)
  return { signerId: parsed.pathname.split('/').at(-1) ?? '', secret: parsed.hash.slice(1) }
}

describe('sending documents for signature', () => {
  test('emails each signer a private link, records every step, and completes with a signed PDF', async () => {
    const runtime = await createCloudTestDatabase()
    try {
      const { email, sent } = recordingEmail()
      const service = createSignatureService(runtime.database, {
        email,
        publicURL: 'https://cloud.example.com',
        downloadSecret: 'test-download-secret-of-enough-length'
      })
      const envelope = await service.create(
        owner,
        {
          title: 'Service contract',
          message: 'Please sign',
          pdf: await samplePDF(),
          signers: [
            { name: 'Ali', email: 'ali@example.com' },
            { name: 'سارة', email: 'sara@example.com' }
          ]
        },
        context
      )
      if (envelope === 'invalid') throw new Error('Expected an envelope')
      expect(envelope.status).toBe('sent')
      expect(envelope.signers.map((signer) => signer.status)).toEqual(['pending', 'pending'])
      const links = sent.map((message) => message.payload.actionURL)
      expect(links).toHaveLength(2)
      expect(links.every((link) => link.startsWith('https://cloud.example.com/sign/'))).toBe(true)
      // The secret is only in the link: the database holds its digest.
      const [first, second] = links.map(linkParts)
      if (!first || !second) throw new Error('Expected two signing links')
      const stored = await runtime.database
        .selectFrom('signatureSigner')
        .select('secretDigest')
        .execute()
      expect(stored.some((row) => row.secretDigest === first.secret)).toBe(false)

      expect(await service.view(first.signerId, '0'.repeat(64), context)).toBeNull()
      const view = await service.view(first.signerId, first.secret, context)
      expect(view).toMatchObject({
        title: 'Service contract',
        signerName: 'Ali',
        signerStatus: 'viewed'
      })

      expect(
        await service.sign(
          first.signerId,
          { secret: first.secret, signature: SIGNATURE, agree: true },
          context
        )
      ).toBe('done')
      expect(
        await service.sign(
          first.signerId,
          { secret: first.secret, signature: SIGNATURE, agree: true },
          context
        )
      ).toBe('closed')
      expect((await service.get(owner, envelope.id))?.status).toBe('sent')

      expect(
        await service.sign(
          second.signerId,
          { secret: second.secret, signature: SIGNATURE, agree: true },
          context
        )
      ).toBe('done')
      const completed = await service.get(owner, envelope.id)
      expect(completed?.status).toBe('completed')
      expect(completed?.finalSHA256).toMatch(/^[0-9a-f]{64}$/)
      expect(completed?.events.map((event) => event.kind)).toEqual([
        'created',
        'sent',
        'sent',
        'viewed',
        'signed',
        'signed',
        'completed'
      ])
      expect(completed?.events.find((event) => event.kind === 'signed')?.ipAddress).toBe(
        '203.0.113.7'
      )

      const pdf = await service.pdf(owner, envelope.id)
      expect(pdf?.signed).toBe(true)
      const final = await PDFDocument.load(pdf?.bytes ?? new Uint8Array())
      expect(final.getPageCount()).toBe(2)
      expect(
        sent
          .filter((message) => message.kind === 'signature-completed')
          .map((message) => message.recipientEmail)
          .sort()
      ).toEqual(['ali@example.com', 'sara@example.com', 'sender@example.com'])
      // Only the sender sees the envelope.
      expect(await service.get({ ...owner, userId: crypto.randomUUID() }, envelope.id)).toBeNull()
    } finally {
      await runtime.close()
    }
  })

  test('a decline closes the envelope for everyone', async () => {
    const runtime = await createCloudTestDatabase()
    try {
      const { email, sent } = recordingEmail()
      const service = createSignatureService(runtime.database, {
        email,
        publicURL: 'https://cloud.example.com',
        downloadSecret: 'test-download-secret-of-enough-length'
      })
      const envelope = await service.create(
        owner,
        {
          title: 'NDA',
          message: '',
          pdf: await samplePDF(),
          signers: [
            { name: 'A', email: 'a@example.com' },
            { name: 'B', email: 'b@example.com' }
          ]
        },
        context
      )
      if (envelope === 'invalid') throw new Error('Expected an envelope')
      const [first, second] = sent.map((message) => linkParts(message.payload.actionURL))
      if (!first || !second) throw new Error('Expected two signing links')
      expect(
        await service.decline(
          first.signerId,
          { secret: first.secret, reason: 'Wrong terms' },
          context
        )
      ).toBe('done')
      expect(
        await service.sign(
          second.signerId,
          { secret: second.secret, signature: SIGNATURE, agree: true },
          context
        )
      ).toBe('closed')
      const declined = await service.get(owner, envelope.id)
      expect(declined?.status).toBe('declined')
      expect(declined?.signers[0]).toMatchObject({
        status: 'declined',
        declineReason: 'Wrong terms'
      })
    } finally {
      await runtime.close()
    }
  })

  test('refuses a file that is not a PDF, and malformed signing requests', async () => {
    const runtime = await createCloudTestDatabase()
    try {
      const service = createSignatureService(runtime.database, {
        publicURL: 'https://cloud.example.com',
        downloadSecret: 'test-download-secret-of-enough-length'
      })
      const result = await service.create(
        owner,
        {
          title: 'x',
          message: '',
          pdf: fromUint8Array(new TextEncoder().encode('hello')),
          signers: [{ name: 'A', email: 'a@example.com' }]
        },
        context
      )
      expect(result).toBe('invalid')
      const app = new Hono().route('/', createPublicSigningRoutes(service, { trustedHeaders: [] }))
      const response = await app.request(`/signing/${crypto.randomUUID()}/view`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: 'short' })
      })
      expect(response.status).toBe(400)
    } finally {
      await runtime.close()
    }
  })
})
