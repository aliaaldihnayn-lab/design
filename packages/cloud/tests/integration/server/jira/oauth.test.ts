import { describe, expect, test } from 'bun:test'

import { createCloudTestDatabase } from '#cloud-tests/helpers/database'
import { responseJSON } from '#cloud-tests/helpers/response'
import { jiraOAuthAuthorizationSchema, jiraOAuthTokenSchema } from '#cloud/contract'
import type { CloudAPIEnvironment } from '#cloud/server/api/types'
import {
  createJiraConnectionService,
  createJiraRoutes,
  createPublicJiraRoutes
} from '#cloud/server/jira'
import { Hono } from 'hono'
import * as v from 'valibot'

const SECRET = 'integration-test-secret-at-least-32-characters'
const actor = { userId: crypto.randomUUID(), email: 'sara@example.com', name: 'Sara' }
const oauth = {
  clientId: 'client-id',
  clientSecret: 'client-secret',
  publicURL: 'https://cloud.example.com'
}
const CLOUD_ID = 'cloud-1234'

/** Atlassian's token, resources and Jira endpoints, as far as the flow reaches them. */
function fakeAtlassian() {
  const state = { issued: 0, refreshes: 0, expiresIn: 3600, calls: [] as string[] }
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  const fetch = async (input: string, init: RequestInit) => {
    state.calls.push(input)
    if (input === 'https://auth.atlassian.com/oauth/token') {
      const body = v.parse(
        v.pipe(v.string(), v.parseJson(), v.record(v.string(), v.string())),
        typeof init.body === 'string' ? init.body : ''
      )
      if (body.client_secret !== 'client-secret') return json({ error: 'invalid_client' }, 401)
      if (body.grant_type === 'authorization_code' && body.code !== 'good-code') {
        return json({ error: 'invalid_grant' }, 403)
      }
      if (body.grant_type === 'refresh_token') {
        if (body.refresh_token !== `refresh-${state.issued}`) return json({ error: 'invalid' }, 403)
        state.refreshes++
      }
      state.issued++
      return json({
        access_token: `access-${state.issued}`,
        refresh_token: `refresh-${state.issued}`,
        expires_in: state.expiresIn,
        scope: 'read:jira-work write:jira-work offline_access'
      })
    }
    const authorization = new Headers(init.headers).get('Authorization')
    if (input === 'https://api.atlassian.com/oauth/token/accessible-resources') {
      return json([
        { id: 'confluence-only', url: 'https://wiki.atlassian.net', name: 'Wiki', scopes: [] },
        {
          id: CLOUD_ID,
          url: 'https://lawha-test.atlassian.net',
          name: 'Lawha',
          scopes: ['read:jira-work', 'write:jira-work']
        }
      ])
    }
    if (input === `https://api.atlassian.com/ex/jira/${CLOUD_ID}/rest/api/3/myself`) {
      return authorization === `Bearer access-${state.issued}`
        ? json({ accountId: 'a', displayName: 'Sara' })
        : json({}, 401)
    }
    return json({}, 404)
  }
  return { fetch, state }
}

function app(service: ReturnType<typeof createJiraConnectionService>) {
  return new Hono<CloudAPIEnvironment>()
    .route('/public/integrations/jira', createPublicJiraRoutes(service))
    .use('*', async (context, next) => {
      context.set('actor', actor)
      await next()
    })
    .route('/integrations/jira', createJiraRoutes(service))
}

async function authorizeAndCallback(routes: ReturnType<typeof app>, code = 'good-code') {
  const { url } = await responseJSON(
    await routes.request('/integrations/jira/oauth/authorize', { method: 'POST' }),
    jiraOAuthAuthorizationSchema
  )
  const consent = new URL(url)
  const state = consent.searchParams.get('state') ?? ''
  const callback = await routes.request(
    `/public/integrations/jira/oauth/callback?${new URLSearchParams({ code, state })}`
  )
  return { consent, state, callback }
}

describe('Jira OAuth 2.0 (3LO)', () => {
  test('authorizes, finds the site cloud ID, and hands out access tokens', async () => {
    const runtime = await createCloudTestDatabase()
    try {
      const atlassian = fakeAtlassian()
      const routes = app(
        createJiraConnectionService(runtime.database, {
          secret: SECRET,
          fetch: atlassian.fetch,
          oauth
        })
      )
      const { consent, callback } = await authorizeAndCallback(routes)
      expect(consent.origin + consent.pathname).toBe('https://auth.atlassian.com/authorize')
      expect(consent.searchParams.get('audience')).toBe('api.atlassian.com')
      expect(consent.searchParams.get('redirect_uri')).toBe(
        'https://cloud.example.com/api/public/integrations/jira/oauth/callback'
      )
      expect(consent.searchParams.get('scope')).toContain('offline_access')
      expect(callback.status).toBe(302)
      expect(callback.headers.get('Location')).toBe('/?jira=connected')

      const status = await routes.request('/integrations/jira')
      expect(await status.json()).toMatchObject({
        connection: { kind: 'oauth', site: 'https://lawha-test.atlassian.net' }
      })
      const token = await responseJSON(
        await routes.request('/integrations/jira/oauth/token'),
        jiraOAuthTokenSchema
      )
      expect(token).toMatchObject({ accessToken: 'access-1', cloudId: CLOUD_ID })

      // The server's own forwarding reaches the site through api.atlassian.com too.
      const forwarded = await routes.request('/integrations/jira/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'GET', path: '/rest/api/3/myself' })
      })
      expect(await forwarded.json()).toMatchObject({ status: 200 })

      const row = await runtime.database
        .selectFrom('jiraConnection')
        .selectAll()
        .executeTakeFirstOrThrow()
      expect(row.refreshTokenEncrypted).not.toContain('refresh-1')
      expect(row.accessTokenEncrypted).not.toContain('access-1')
    } finally {
      await runtime.close()
    }
  })

  test('refreshes an access token about to expire and keeps the rotated refresh token', async () => {
    const runtime = await createCloudTestDatabase()
    try {
      const atlassian = fakeAtlassian()
      atlassian.state.expiresIn = 30
      const routes = app(
        createJiraConnectionService(runtime.database, {
          secret: SECRET,
          fetch: atlassian.fetch,
          oauth
        })
      )
      await authorizeAndCallback(routes)
      const first = await responseJSON(
        await routes.request('/integrations/jira/oauth/token'),
        jiraOAuthTokenSchema
      )
      expect(first.accessToken).toBe('access-2')
      const second = await responseJSON(
        await routes.request('/integrations/jira/oauth/token'),
        jiraOAuthTokenSchema
      )
      // Each refresh used the refresh token the one before it returned.
      expect(second.accessToken).toBe('access-3')
      expect(atlassian.state.refreshes).toBe(2)
    } finally {
      await runtime.close()
    }
  })

  test('turns away a reused or unknown state and a refused code', async () => {
    const runtime = await createCloudTestDatabase()
    try {
      const atlassian = fakeAtlassian()
      const routes = app(
        createJiraConnectionService(runtime.database, {
          secret: SECRET,
          fetch: atlassian.fetch,
          oauth
        })
      )
      const refused = await authorizeAndCallback(routes, 'bad-code')
      expect(refused.callback.headers.get('Location')).toBe('/?jira=failed')
      const { state } = await authorizeAndCallback(routes)
      const again = await routes.request(
        `/public/integrations/jira/oauth/callback?${new URLSearchParams({ code: 'good-code', state })}`
      )
      expect(again.headers.get('Location')).toBe('/?jira=failed')
      const unknown = await routes.request(
        '/public/integrations/jira/oauth/callback?code=good-code&state=nope'
      )
      expect(unknown.headers.get('Location')).toBe('/?jira=failed')
    } finally {
      await runtime.close()
    }
  })

  test('has no authorization without an Atlassian app', async () => {
    const runtime = await createCloudTestDatabase()
    try {
      const routes = app(createJiraConnectionService(runtime.database, { secret: SECRET }))
      expect(
        (await routes.request('/integrations/jira/oauth/authorize', { method: 'POST' })).status
      ).toBe(404)
      expect((await routes.request('/integrations/jira/oauth/token')).status).toBe(404)
    } finally {
      await runtime.close()
    }
  })
})
