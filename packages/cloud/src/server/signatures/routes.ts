import {
  createSignatureEnvelopeSchema,
  declineSigningSchema,
  signDocumentSchema,
  signingSecretSchema
} from '#cloud/contract'
import type { CloudAPIEnvironment } from '#cloud/server/api/types'
import { trustedClientIP } from '#cloud/server/rate-limit'
import { validatedJSON } from '#cloud/server/validation'
import { Hono, type Context } from 'hono'
import * as v from 'valibot'

import type { SignatureService, SigningOutcome, SigningRequestContext } from './service'

export type SigningRouteOptions = {
  /** Proxy headers that carry the client's address, as the rate limiters trust them. */
  trustedHeaders: string[]
}

function requestContext(context: Context, options: SigningRouteOptions): SigningRequestContext {
  return {
    ipAddress: trustedClientIP(context, { trustedHeaders: options.trustedHeaders }),
    userAgent: context.req.header('User-Agent')?.slice(0, 300) ?? null
  }
}

const notFound = (context: Context) => context.json({ error: { code: 'not_found' as const } }, 404)

function outcome(context: Context, result: SigningOutcome) {
  if (result === 'done') return context.json({ ok: true as const })
  if (result === 'invalid')
    return context.json({ error: { code: 'invalid_request' as const } }, 400)
  if (result === 'closed') return context.json({ error: { code: 'conflict' as const } }, 409)
  return notFound(context)
}

/** The sender's routes: send a PDF for signature, follow it, and download the signed PDF. */
export function createSignatureRoutes(service: SignatureService, options: SigningRouteOptions) {
  return new Hono<CloudAPIEnvironment>()
    .post(
      '/',
      validatedJSON((input) => v.parse(createSignatureEnvelopeSchema, input)),
      async (context) => {
        const envelope = await service.create(
          context.get('actor'),
          context.req.valid('json'),
          requestContext(context, options)
        )
        if (envelope === 'invalid') {
          return context.json({ error: { code: 'invalid_request' as const } }, 400)
        }
        return context.json({ envelope }, 201)
      }
    )
    .get('/', async (context) =>
      context.json({ envelopes: await service.list(context.get('actor')) })
    )
    .get('/:envelopeId', async (context) => {
      const envelope = await service.get(context.get('actor'), context.req.param('envelopeId'))
      return envelope ? context.json({ envelope }) : notFound(context)
    })
    .get('/:envelopeId/pdf', async (context) => {
      const pdf = await service.pdf(context.get('actor'), context.req.param('envelopeId'))
      if (!pdf) return notFound(context)
      context.header('Content-Type', 'application/pdf')
      context.header('Content-Disposition', 'attachment; filename="signed.pdf"')
      context.header('X-Content-Type-Options', 'nosniff')
      return context.body(new Uint8Array(pdf.bytes))
    })
    .post('/:envelopeId/void', async (context) => {
      const voided = await service.void(
        context.get('actor'),
        context.req.param('envelopeId'),
        requestContext(context, options)
      )
      return voided ? context.json({ ok: true as const }) : notFound(context)
    })
}

/** A signer's routes, opened with the secret from their link. */
export function createPublicSigningRoutes(service: SignatureService, options: SigningRouteOptions) {
  return new Hono<CloudAPIEnvironment>()
    .post(
      '/signing/:signerId/view',
      validatedJSON((input) => v.parse(signingSecretSchema, input)),
      async (context) => {
        const view = await service.view(
          context.req.param('signerId'),
          context.req.valid('json').secret,
          requestContext(context, options)
        )
        return view ? context.json({ signing: view }) : notFound(context)
      }
    )
    .post(
      '/signing/:signerId/sign',
      validatedJSON((input) => v.parse(signDocumentSchema, input)),
      async (context) =>
        outcome(
          context,
          await service.sign(
            context.req.param('signerId'),
            context.req.valid('json'),
            requestContext(context, options)
          )
        )
    )
    .post(
      '/signing/:signerId/decline',
      validatedJSON((input) => v.parse(declineSigningSchema, input)),
      async (context) =>
        outcome(
          context,
          await service.decline(
            context.req.param('signerId'),
            context.req.valid('json'),
            requestContext(context, options)
          )
        )
    )
}
