import { describe, expect, setDefaultTimeout, test } from 'bun:test'

import { createCloudTestDatabase } from '#cloud-tests/helpers/database'
import type { EnqueueTransactionalEmailInput, TransactionalEmailService } from '#cloud/server/email'
import { createSignatureService, readSealCredentials } from '#cloud/server/signatures'
import { readSignatureFont } from '#cloud/server/signatures/fonts/read'
import { PDFDict, PDFDocument, PDFName } from '@cantoo/pdf-lib'
import { fromUint8Array } from 'js-base64'
import forge from 'node-forge'

setDefaultTimeout(120_000)

const SIGNATURE =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='
const owner = { userId: crypto.randomUUID(), email: 'sender@example.com', name: 'Sender' }
const context = { ipAddress: '203.0.113.7', userAgent: 'test' }

/** A self-signed seal certificate as a deployment would configure it: base64 PKCS #12. */
function sealPKCS12(): string {
  const keys = forge.pki.rsa.generateKeyPair(2048)
  const certificate = forge.pki.createCertificate()
  certificate.publicKey = keys.publicKey
  certificate.serialNumber = '01'
  certificate.validity.notBefore = new Date(Date.now() - 86_400_000)
  certificate.validity.notAfter = new Date(Date.now() + 86_400_000 * 365)
  const subject = [{ name: 'commonName', value: 'Lawha Cloud Seal' }]
  certificate.setSubject(subject)
  certificate.setIssuer(subject)
  certificate.sign(keys.privateKey, forge.md.sha256.create())
  const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [certificate], 'seal-password', {
    algorithm: '3des'
  })
  return forge.util.encode64(forge.asn1.toDer(p12).getBytes())
}

/** Bytes as a binary string; TextDecoder's latin1 is windows-1252 and changes 0x80 to 0x9f. */
const latin1 = (bytes: Uint8Array) => {
  let out = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    out += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return out
}

function sealContents(final: Uint8Array) {
  const text = latin1(final)
  const match = [...text.matchAll(/\/ByteRange \[(\d+) (\d+) (\d+) (\d+)\]/g)].at(-1)
  const [start, end] = [Number(match?.[2]), Number(match?.[3])]
  return { text, start, end, match }
}

/** The SHA-256 of the bytes the seal covers: the whole file but its own contents. */
function sealedContentDigest(final: Uint8Array): string {
  const { start, end, match } = sealContents(final)
  expect(Number(match?.[1])).toBe(0)
  expect(end + Number(match?.[4])).toBe(final.length)
  const covered = latin1(final.subarray(0, start)) + latin1(final.subarray(end))
  return forge.md.sha256.create().update(covered).digest().toHex()
}

function sealMessage(final: Uint8Array) {
  const { text, start, end } = sealContents(final)
  expect(text).toContain('/SubFilter /adbe.pkcs7.detached')
  const der = forge.util.hexToBytes(text.slice(start + 1, end - 1).replace(/(00)+$/, ''))
  return forge.asn1.fromDer(der)
}

/** The messageDigest attribute the seal signed, found by its OID in the CMS structure. */
function sealDigest(final: Uint8Array): string | null {
  const find = (node: forge.asn1.Asn1): string | null => {
    if (!Array.isArray(node.value)) return null
    const [first, second] = node.value
    if (
      first?.type === forge.asn1.Type.OID &&
      typeof first.value === 'string' &&
      forge.asn1.derToOid(first.value) === '1.2.840.113549.1.9.4' &&
      Array.isArray(second?.value)
    ) {
      const octets = second.value[0]?.value
      return typeof octets === 'string' ? forge.util.bytesToHex(octets) : null
    }
    for (const child of node.value) {
      const found = find(child)
      if (found) return found
    }
    return null
  }
  return find(sealMessage(final))
}

function sealSigner(final: Uint8Array): unknown {
  const message = forge.pkcs7.messageFromAsn1(sealMessage(final))
  return 'certificates' in message ? message.certificates[0]?.subject.getField('CN').value : null
}

describe('completed envelopes', () => {
  test('are sealed by the server, name Arabic signers in an embedded font, and email a download link', async () => {
    const runtime = await createCloudTestDatabase()
    try {
      const sent: EnqueueTransactionalEmailInput<'signature-request' | 'signature-completed'>[] = []
      const email: TransactionalEmailService = {
        enqueue: async (input) => {
          if (input.kind === 'signature-request' || input.kind === 'signature-completed') {
            sent.push(input as (typeof sent)[number])
          }
          return crypto.randomUUID()
        },
        deliverPending: async () => ({
          claimed: 0,
          accepted: 0,
          retrying: 0,
          failed: 0,
          suppressed: 0
        })
      }
      const service = createSignatureService(runtime.database, {
        email,
        publicURL: 'https://cloud.example.com',
        downloadSecret: 'test-download-secret-of-enough-length',
        seal: readSealCredentials(sealPKCS12(), 'seal-password'),
        scriptFont: await readSignatureFont()
      })
      const pdf = await PDFDocument.create()
      pdf.addPage([595, 842])
      const envelope = await service.create(
        owner,
        {
          title: 'عقد خدمات',
          message: '',
          pdf: fromUint8Array(await pdf.save()),
          signers: [{ name: 'علي الدهنين', email: 'ali@example.com' }]
        },
        context
      )
      if (envelope === 'invalid') throw new Error('Expected an envelope')
      const link = new URL(sent[0]?.payload.actionURL ?? '')
      const signerId = link.pathname.split('/').at(-1) ?? ''
      expect(
        await service.sign(
          signerId,
          { secret: link.hash.slice(1), signature: SIGNATURE, agree: true },
          context
        )
      ).toBe('done')

      const final = (await service.pdf(owner, envelope.id))?.bytes ?? new Uint8Array()
      expect(sealDigest(final)).toEqual(sealedContentDigest(final))
      expect(sealSigner(final)).toBe('Lawha Cloud Seal')

      // The audit page draws the Arabic name in the embedded Arabic font.
      const loaded = await PDFDocument.load(final)
      const fonts = loaded.getPages().at(-1)?.node.Resources()?.lookup(PDFName.of('Font'), PDFDict)
      const names = (fonts?.keys() ?? []).map((key) =>
        fonts?.lookup(key, PDFDict).get(PDFName.of('BaseFont'))?.toString()
      )
      expect(names.some((name) => name?.includes('NotoNaskhArabic'))).toBe(true)

      // Everyone's completion email links straight to the signed PDF.
      const completed = sent.find((entry) => entry.kind === 'signature-completed')
      const download = new URL(completed?.payload.actionURL ?? '')
      expect(download.pathname).toBe('/sign/download')
      const opened = await service.download(download.hash.slice(1))
      expect(opened?.bytes).toEqual(final)
      expect(await service.download(`${envelope.id}.${'0'.repeat(64)}`)).toBeNull()
    } finally {
      await runtime.close()
    }
  })
})
