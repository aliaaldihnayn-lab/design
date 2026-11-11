import {
  JIRA_OAUTH_RESULT_PARAM,
  jiraConnectionInputSchema,
  jiraForwardRequestSchema
} from '#cloud/contract'
import type { CloudAPIEnvironment } from '#cloud/server/api/types'
import { validatedJSON } from '#cloud/server/validation'
import { Hono, type Context } from 'hono'
import { withQuery } from 'ufo'
import * as v from 'valibot'

import type { JiraConnectionService } from './service'

const notConnected = (context: Context) =>
  context.json({ error: { code: 'not_found' as const } }, 404)

/** The person's Jira connection, and the requests their stories make to it. */
export function createJiraRoutes(service: JiraConnectionService | undefined) {
  return new Hono<CloudAPIEnvironment>()
    .get('/', async (context) => {
      if (!service) return notConnected(context)
      return context.json({
        connection: await service.status(context.get('actor')),
        oauth: service.oauthAvailable
      })
    })
    .put(
      '/',
      validatedJSON((input) => v.parse(jiraConnectionInputSchema, input)),
      async (context) => {
        if (!service) return notConnected(context)
        const outcome = await service.connect(context.get('actor'), context.req.valid('json'))
        if (outcome === 'site')
          return context.json({ error: { code: 'invalid_request' as const } }, 400)
        if (outcome === 'unreachable') {
          return context.json({ error: { code: 'jira_unreachable' as const } }, 502)
        }
        if ('rejected' in outcome) {
          return context.json(
            { error: { code: 'jira_rejected' as const, status: outcome.rejected } },
            422
          )
        }
        return context.json({ connection: outcome.connection })
      }
    )
    .delete('/', async (context) => {
      if (!service) return notConnected(context)
      await service.disconnect(context.get('actor'))
      return context.json({ ok: true as const })
    })
    .post(
      '/request',
      validatedJSON((input) => v.parse(jiraForwardRequestSchema, input)),
      async (context) => {
        if (!service) return notConnected(context)
        try {
          const response = await service.forward(context.get('actor'), context.req.valid('json'))
          return response ? context.json(response) : notConnected(context)
        } catch {
          return context.json({ error: { code: 'jira_unreachable' as const } }, 502)
        }
      }
    )
    .post('/oauth/authorize', async (context) => {
      const url = service ? await service.authorize(context.get('actor')) : null
      return url ? context.json({ url }) : notConnected(context)
    })
    .get('/oauth/token', async (context) => {
      if (!service) return notConnected(context)
      try {
        const token = await service.oauthToken(context.get('actor'))
        return token ? context.json(token) : notConnected(context)
      } catch {
        return context.json({ error: { code: 'jira_unreachable' as const } }, 502)
      }
    })
}

/**
 * Where Atlassian sends the person back. It finishes the authorization the single-use `state`
 * names and sends them on to the Cloud site, saying in its query how it went.
 */
export function createPublicJiraRoutes(service: JiraConnectionService | undefined) {
  // The callback is on the server's own origin, so its site's root is `/`.
  const done = (context: Context, result: 'connected' | 'failed') =>
    context.redirect(withQuery('/', { [JIRA_OAUTH_RESULT_PARAM]: result }))
  return new Hono<CloudAPIEnvironment>().get('/oauth/callback', async (context) => {
    const state = context.req.query('state')
    const code = context.req.query('code')
    if (!service || !state || !code) return done(context, 'failed')
    try {
      return done(
        context,
        (await service.completeAuthorization(state, code)) ? 'connected' : 'failed'
      )
    } catch {
      return done(context, 'failed')
    }
  })
}
