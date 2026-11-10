import { describe, expect, test } from 'bun:test'

import { createCloudTestDatabase } from '#cloud-tests/helpers/database'
import { responseJSON } from '#cloud-tests/helpers/response'
import type { CloudAPIEnvironment } from '#cloud/server/api/types'
import { createJiraConnectionService, createJiraRoutes, isJiraCloudSite } from '#cloud/server/jira'
import { Hono } from 'hono'
import { encode } from 'js-base64'
import * as v from 'valibot'

const SECRET = 'integration-test-secret-at-least-32-characters'
const SITE = 'https://lawha-test.atlassian.net'
const actor = { userId: crypto.randomUUID(), email: 'sara@example.com', name: 'Sara' }

/** A Jira site that accepts one email and token, and records what reached it. */
function fakeSite() {
  const calls: Array<{
    url: string
    method: string
    authorization: string | null
    redirect?: string
  }> = []
  const fetch = async (input: string, init: RequestInit) => {
    const authorization = new Headers(init.headers).get('Authorization')
    calls.push({ url: input, method: init.method ?? 'GET', authorization, redirect: init.redirect })
    if (authorization !== `Basic ${encode('sara@example.com:good-token')}`) {
      return new Response(JSON.stringify({ errorMessages: ['Unauthorized'] }), { status: 401 })
    }
    if (input.endsWith('/rest/api/3/myself')) {
      return new Response(JSON.stringify({ accountId: 'a', displayName: 'Sara' }), { status: 200 })
    }
    if (input.endsWith('/rest/api/3/issue') && init.method === 'POST') {
      return new Response(JSON.stringify({ id: '10001', key: 'SHOP-1' }), { status: 201 })
    }
    return new Response(JSON.stringify({ errorMessages: ['Not found'] }), { status: 404 })
  }
  return { fetch, calls }
}

function app(service: ReturnType<typeof createJiraConnectionService>) {
  return new Hono<CloudAPIEnvironment>()
    .use('*', async (context, next) => {
      context.set('actor', actor)
      await next()
    })
    .route('/integrations/jira', createJiraRoutes(service))
}

const connectionSchema = v.object({
  connection: v.nullable(v.object({ site: v.string(), email: v.string(), updatedAt: v.string() }))
})

describe('Jira connection', () => {
  test('keeps the site only after Jira accepts the token, and never returns the token', async () => {
    const runtime = await createCloudTestDatabase()
    try {
      const site = fakeSite()
      const routes = app(
        createJiraConnectionService(runtime.database, { secret: SECRET, fetch: site.fetch })
      )
      const put = (apiToken: string) =>
        routes.request('/integrations/jira', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            site: `${SITE}/jira/your-work`,
            email: 'sara@example.com',
            apiToken
          })
        })

      expect((await put('wrong')).status).toBe(422)
      const empty = await responseJSON(await routes.request('/integrations/jira'), connectionSchema)
      expect(empty.connection).toBeNull()

      const accepted = await put('good-token')
      expect(accepted.status).toBe(200)
      const text = await accepted.clone().text()
      expect(text).not.toContain('good-token')
      expect((await responseJSON(accepted, connectionSchema)).connection).toMatchObject({
        site: SITE,
        email: 'sara@example.com'
      })

      const row = await runtime.database
        .selectFrom('jiraConnection')
        .selectAll()
        .executeTakeFirstOrThrow()
      expect(row.apiTokenEncrypted).not.toContain('good-token')
      // A compact JWE: header, empty key (direct), IV, ciphertext and tag.
      expect(row.apiTokenEncrypted.split('.')).toHaveLength(5)
    } finally {
      await runtime.close()
    }
  })

  test('forwards the stories’ requests as the person, and only to Jira', async () => {
    const runtime = await createCloudTestDatabase()
    try {
      const site = fakeSite()
      const routes = app(
        createJiraConnectionService(runtime.database, { secret: SECRET, fetch: site.fetch })
      )
      const forward = (body: unknown) =>
        routes.request('/integrations/jira/request', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        })
      // Nothing is connected yet.
      expect((await forward({ method: 'GET', path: '/rest/api/3/myself' })).status).toBe(404)

      await routes.request('/integrations/jira', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ site: SITE, email: 'sara@example.com', apiToken: 'good-token' })
      })
      const created = await forward({
        method: 'POST',
        path: '/rest/api/3/issue',
        body: { fields: {} }
      })
      expect(
        await responseJSON(created, v.object({ status: v.number(), body: v.unknown() }))
      ).toEqual({
        status: 201,
        body: { id: '10001', key: 'SHOP-1' }
      })
      const last = site.calls.at(-1)
      expect(last).toMatchObject({
        url: `${SITE}/rest/api/3/issue`,
        method: 'POST',
        redirect: 'manual'
      })

      // Paths outside the stories' REST calls are refused before anything is sent.
      const before = site.calls.length
      expect((await forward({ method: 'GET', path: '/rest/api/3/user/bulk' })).status).toBe(400)
      expect(
        (await forward({ method: 'GET', path: '/rest/api/3/issue/SHOP-1/../../x' })).status
      ).toBe(400)
      expect(site.calls.length).toBe(before)

      expect((await routes.request('/integrations/jira', { method: 'DELETE' })).status).toBe(200)
      expect((await forward({ method: 'GET', path: '/rest/api/3/myself' })).status).toBe(404)
    } finally {
      await runtime.close()
    }
  })

  test('only Jira Cloud hosts are accepted as sites', async () => {
    expect(isJiraCloudSite('https://acme.atlassian.net')).toBe(true)
    expect(isJiraCloudSite('https://acme.jira.com')).toBe(true)
    expect(isJiraCloudSite('http://acme.atlassian.net')).toBe(false)
    expect(isJiraCloudSite('https://169.254.169.254')).toBe(false)
    expect(isJiraCloudSite('https://atlassian.net.evil.example')).toBe(false)
    expect(isJiraCloudSite('https://acme.atlassian.net:8443')).toBe(false)

    const runtime = await createCloudTestDatabase()
    try {
      const site = fakeSite()
      const routes = app(
        createJiraConnectionService(runtime.database, { secret: SECRET, fetch: site.fetch })
      )
      const response = await routes.request('/integrations/jira', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          site: 'https://intranet.example',
          email: 'sara@example.com',
          apiToken: 'good-token'
        })
      })
      expect(response.status).toBe(400)
      expect(site.calls).toEqual([])
    } finally {
      await runtime.close()
    }
  })
})
