import { afterEach, describe, expect, test } from 'bun:test'

import { encode } from 'js-base64'

import { getJiraConnection, setJiraConnection, type JiraFetch } from '@lawha/core/stories'

import {
  connectJira,
  connectJiraWithAtlassian,
  disconnectJira,
  refreshJiraConnection,
  JIRA_API_TOKEN_CREDENTIAL,
  jiraConnected,
  jiraPreferences,
  type JiraConnectionDeps,
  type JiraOAuthServer
} from '@/app/integrations/jira/connection'
import { createCredentialServices } from '@/app/settings/credentials'
import { MemoryCredentialStore } from '@/app/settings/credentials/memory'

/** A Jira site that knows one account, answering `/rest/api/3/myself` as Jira does. */
function site(): { fetch: JiraFetch; urls: string[] } {
  const urls: string[] = []
  const good = `Basic ${encode('sara@example.com:good-token')}`
  return {
    urls,
    fetch: async (input, init) => {
      urls.push(input)
      const authorized = new Headers(init.headers).get('Authorization') === good
      return authorized
        ? new Response(JSON.stringify({ accountId: 'a', displayName: 'Sara' }), { status: 200 })
        : new Response(JSON.stringify({ errorMessages: ['Unauthorized'] }), { status: 401 })
    }
  }
}

function desktop(fetch: JiraFetch): JiraConnectionDeps {
  return {
    credentials: createCredentialServices(new MemoryCredentialStore()),
    fetch,
    mode: () => 'desktop'
  }
}

afterEach(() => {
  setJiraConnection(null)
  jiraConnected.value = null
  jiraPreferences.value = { site: '', email: '', projectKey: '', auth: 'token' }
})

describe('Jira connection on desktop', () => {
  test('keeps the token in the credential store only after Jira accepts it', async () => {
    const jira = site()
    const deps = desktop(jira.fetch)
    expect(
      await connectJira(
        { site: 'lawha-test.atlassian.net', email: 'sara@example.com', apiToken: 'bad' },
        deps
      )
    ).toBe('rejected')
    expect(await deps.credentials.manager.status(JIRA_API_TOKEN_CREDENTIAL)).toBe('missing')

    expect(
      await connectJira(
        {
          site: 'https://lawha-test.atlassian.net/jira/your-work',
          email: 'sara@example.com',
          apiToken: 'good-token'
        },
        deps
      )
    ).toBe('connected')
    expect(jira.urls.at(-1)).toBe('https://lawha-test.atlassian.net/rest/api/3/myself')
    expect(await deps.credentials.resolver.resolve(JIRA_API_TOKEN_CREDENTIAL)).toBe('good-token')
    // Preferences hold the site and email, never the token.
    expect(jiraPreferences.value).toMatchObject({
      site: 'https://lawha-test.atlassian.net',
      email: 'sara@example.com'
    })
    expect(JSON.stringify(jiraPreferences.value)).not.toContain('good-token')
    expect(getJiraConnection()?.site).toBe('https://lawha-test.atlassian.net')
  })

  test('the published client reads the token for each request', async () => {
    const jira = site()
    const deps = desktop(jira.fetch)
    await connectJira(
      { site: 'lawha-test.atlassian.net', email: 'sara@example.com', apiToken: 'good-token' },
      deps
    )
    const connection = getJiraConnection()
    if (!connection) throw new Error('not connected')
    expect(await connection.client.myself()).toEqual({ accountId: 'a', displayName: 'Sara' })

    await disconnectJira(deps)
    expect(getJiraConnection()).toBeNull()
    expect(await deps.credentials.manager.status(JIRA_API_TOKEN_CREDENTIAL)).toBe('missing')
    // A client kept from before fails rather than calling Jira without a token.
    await expect(connection.client.myself()).rejects.toThrow()
  })

  test('an address that is not https is refused before Jira is asked', async () => {
    const jira = site()
    expect(
      await connectJira(
        { site: 'http://intranet', email: 'sara@example.com', apiToken: 'good-token' },
        desktop(jira.fetch)
      )
    ).toBe('invalid-site')
    expect(jira.urls).toEqual([])
  })

  test('without the desktop app or a Cloud sign-in, the browser cannot connect', async () => {
    const jira = site()
    const deps = { ...desktop(jira.fetch), mode: () => 'unavailable' as const }
    expect(
      await connectJira(
        { site: 'lawha-test.atlassian.net', email: 'sara@example.com', apiToken: 'good-token' },
        deps
      )
    ).toBe('unavailable')
  })
})

describe('Jira connection through Atlassian OAuth', () => {
  /** A Home server holding an OAuth connection, and the Jira site behind api.atlassian.com. */
  function oauthSetup() {
    const state = { issued: 0, opened: [] as string[], urls: [] as string[] }
    const server: JiraOAuthServer = {
      authorize: async () => 'https://auth.atlassian.com/authorize?state=s',
      token: async () => {
        state.issued++
        return {
          accessToken: `access-${state.issued}`,
          cloudId: 'cloud-1',
          site: 'https://lawha-test.atlassian.net',
          expiresAt: new Date(Date.now() + 3_600_000).toISOString()
        }
      },
      integration: async () => ({
        oauth: true,
        connection: {
          kind: 'oauth',
          site: 'https://lawha-test.atlassian.net',
          email: '',
          updatedAt: new Date(0).toISOString()
        }
      })
    }
    const fetch: JiraFetch = async (input, init) => {
      state.urls.push(input)
      const authorized =
        new Headers(init.headers).get('Authorization') === `Bearer access-${state.issued}`
      return authorized
        ? new Response(JSON.stringify({ accountId: 'a', displayName: 'Sara' }), { status: 200 })
        : new Response(JSON.stringify({ errorMessages: ['Unauthorized'] }), { status: 401 })
    }
    const deps: JiraConnectionDeps = {
      ...desktop(fetch),
      mode: () => 'cloud',
      oauth: () => server,
      openURL: async (url) => {
        state.opened.push(url)
      }
    }
    return { deps, state }
  }

  test('opens the consent page the Home server gives', async () => {
    const { deps, state } = oauthSetup()
    expect(await connectJiraWithAtlassian(deps)).toBe('opened')
    expect(state.opened).toEqual(['https://auth.atlassian.com/authorize?state=s'])
    expect(await connectJiraWithAtlassian({ ...deps, oauth: () => null })).toBe('unavailable')
  })

  test('reaches the site through api.atlassian.com with access tokens the server hands out', async () => {
    const { deps, state } = oauthSetup()
    await refreshJiraConnection(deps)
    expect(jiraConnected.value).toBe(true)
    expect(jiraPreferences.value.auth).toBe('oauth')
    const connection = getJiraConnection()
    if (!connection) throw new Error('not connected')
    expect(await connection.client.myself()).toMatchObject({ displayName: 'Sara' })
    expect(await connection.client.myself()).toMatchObject({ displayName: 'Sara' })
    expect(state.urls.at(-1)).toBe('https://api.atlassian.com/ex/jira/cloud-1/rest/api/3/myself')
    // The token is kept until it is about to expire.
    expect(state.issued).toBe(1)
  })

  test('falls back to the API token once the server holds no OAuth connection', async () => {
    const { deps } = oauthSetup()
    await refreshJiraConnection(deps)
    const server = deps.oauth?.()
    if (!server) throw new Error('no server')
    await refreshJiraConnection({
      ...deps,
      mode: () => 'desktop',
      oauth: () => ({ ...server, integration: async () => ({ oauth: true, connection: null }) })
    })
    expect(jiraPreferences.value.auth).toBe('token')
  })
})
