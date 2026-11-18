import { describe, expect, test } from 'bun:test'

import { renderTransactionalEmail, transactionalEmailContentSchema } from '#cloud/email'
import * as v from 'valibot'

describe('signature emails', () => {
  test('a signature request carries the sender, the document, and the private link', async () => {
    const content = v.parse(transactionalEmailContentSchema, {
      kind: 'signature-request',
      payload: {
        senderName: 'Ali',
        documentName: 'Service contract',
        message: 'Please sign by Friday',
        actionURL: 'https://cloud.example.com/sign/signer-id#secret'
      }
    })
    const email = await renderTransactionalEmail(content)
    expect(email.subject).toContain('Service contract')
    expect(email.html).toContain('https://cloud.example.com/sign/signer-id#secret')
    expect(email.text).toContain('Please sign by Friday')
  })

  test('a completion notice links to the signed PDF', async () => {
    const email = await renderTransactionalEmail({
      kind: 'signature-completed',
      payload: { documentName: 'NDA', actionURL: 'https://cloud.example.com/writer' }
    })
    expect(email.subject).toBe('Signed: NDA')
    expect(email.html).toContain('https://cloud.example.com/writer')
  })
})
