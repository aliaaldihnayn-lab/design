import { afterEach, describe, expect, test } from 'bun:test'

import { encode } from 'js-base64'

import { getJiraConnection, setJiraConnection, type JiraFetch } from '@lawha/core/stories'

import {
  connectJira,
  disconnectJira,
  JIRA_API_TOKEN_CREDENTIAL,
  jiraConnected,
  jiraPreferences,
  type JiraConnectionDeps
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
  jiraPreferences.value = { site: '', email: '', projectKey: '' }
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
