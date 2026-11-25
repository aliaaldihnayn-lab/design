import { describe, expect, test } from 'bun:test'

import { createCloudTestDatabase } from '#cloud-tests/helpers/database'

describe('migration 028', () => {
  test('keeps signers and the audit trail with their envelope and checks their states', async () => {
    const runtime = await createCloudTestDatabase()
    try {
      const { database } = runtime
      const envelopeId = crypto.randomUUID()
      const signerId = crypto.randomUUID()
      await database
        .insertInto('signatureEnvelope')
        .values({
          id: envelopeId,
          ownerId: crypto.randomUUID(),
          senderName: 'سارة',
          senderEmail: 'sara@example.com',
          title: 'عقد',
          message: '',
          status: 'sent',
          originalPdf: new TextEncoder().encode('%PDF-1.7'),
          originalSha256: '0'.repeat(64),
          finalPdf: null,
          finalSha256: null
        })
        .execute()
      const signer = {
        id: signerId,
        envelopeId,
        position: 0,
        name: 'علي',
        email: 'ali@example.com',
        secretDigest: 'a'.repeat(64),
        status: 'pending' as const,
        signaturePng: null,
        declineReason: null
      }
      await database.insertInto('signatureSigner').values(signer).execute()
      await database
        .insertInto('signatureEvent')
        .values({
          id: crypto.randomUUID(),
          envelopeId,
          signerId,
          kind: 'sent',
          ipAddress: null,
          userAgent: null
        })
        .execute()

      // A secret's digest names one signer only.
      await expect(
        database
          .insertInto('signatureSigner')
          .values({ ...signer, id: crypto.randomUUID() })
          .execute()
      ).rejects.toThrow()
      // States outside the contract are refused.
      await expect(
        database
          .updateTable('signatureEnvelope')
          .set({ status: 'archived' as 'sent' })
          .where('id', '=', envelopeId)
          .execute()
      ).rejects.toThrow()
      await expect(
        database
          .updateTable('signatureSigner')
          .set({ status: 'expired' as 'pending' })
          .where('id', '=', signerId)
          .execute()
      ).rejects.toThrow()

      await database.deleteFrom('signatureEnvelope').where('id', '=', envelopeId).execute()
      expect(await database.selectFrom('signatureSigner').selectAll().execute()).toEqual([])
      expect(await database.selectFrom('signatureEvent').selectAll().execute()).toEqual([])
    } finally {
      await runtime.close()
    }
  })
})
