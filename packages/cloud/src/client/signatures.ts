import {
  signatureEnvelopeSchema,
  signingViewSchema,
  type CreateSignatureEnvelopeInput,
  type DeclineSigningInput,
  type SignatureEnvelope,
  type SignDocumentInput,
  type SigningView
} from '#cloud/contract'
import type { CloudAPI, PublicCloudAPI } from '#cloud/server/api'
import type { hc } from 'hono/client'
import * as v from 'valibot'

import { CloudAPIError, parseResponse, responseBody, type CloudClientDiagnostic } from './response'

const envelopeResponseSchema = v.object({ envelope: signatureEnvelopeSchema })
const envelopesResponseSchema = v.object({ envelopes: v.array(signatureEnvelopeSchema) })
const signingResponseSchema = v.object({ signing: signingViewSchema })

/** Sending PDFs for signature, and signing them from a signer's link. */
export function createSignatureRequests(
  client: ReturnType<typeof hc<CloudAPI>>,
  publicClient: ReturnType<typeof hc<PublicCloudAPI>>,
  onDiagnostic?: CloudClientDiagnostic
) {
  return {
    async sendForSignature(input: CreateSignatureEnvelopeInput): Promise<SignatureEnvelope> {
      const response = await parseResponse(
        client.signatures.$post({ json: input }),
        envelopeResponseSchema,
        onDiagnostic
      )
      return response.envelope
    },
    async listSignatureEnvelopes(): Promise<SignatureEnvelope[]> {
      const response = await parseResponse(
        client.signatures.$get(),
        envelopesResponseSchema,
        onDiagnostic
      )
      return response.envelopes
    },
    async getSignatureEnvelope(envelopeId: string): Promise<SignatureEnvelope> {
      const response = await parseResponse(
        client.signatures[':envelopeId'].$get({ param: { envelopeId } }),
        envelopeResponseSchema,
        onDiagnostic
      )
      return response.envelope
    },
    /** The final signed PDF, or the PDF as sent while signatures are pending. */
    async downloadSignaturePDF(envelopeId: string): Promise<Uint8Array> {
      const response = await client.signatures[':envelopeId'].pdf.$get({ param: { envelopeId } })
      if (!response.ok) throw new CloudAPIError('Could not download the PDF', response.status)
      return new Uint8Array(await response.arrayBuffer())
    },
    async voidSignatureEnvelope(envelopeId: string): Promise<void> {
      await responseBody(
        await client.signatures[':envelopeId'].void.$post({ param: { envelopeId } }),
        onDiagnostic
      )
    },
    async viewSigning(signerId: string, secret: string): Promise<SigningView> {
      const response = await parseResponse(
        publicClient.signing[':signerId'].view.$post({ param: { signerId }, json: { secret } }),
        signingResponseSchema,
        onDiagnostic
      )
      return response.signing
    },
    async signDocument(signerId: string, input: SignDocumentInput): Promise<void> {
      await responseBody(
        await publicClient.signing[':signerId'].sign.$post({ param: { signerId }, json: input }),
        onDiagnostic
      )
    },
    async declineSigning(signerId: string, input: DeclineSigningInput): Promise<void> {
      await responseBody(
        await publicClient.signing[':signerId'].decline.$post({ param: { signerId }, json: input }),
        onDiagnostic
      )
    }
  }
}
