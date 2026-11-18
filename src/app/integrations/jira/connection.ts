import { useStorage } from '@vueuse/core'
import { computed, ref, watch } from 'vue'

import type { JiraConnectionStatus, JiraOAuthToken } from '@lawha/cloud/contract'
import {
  basicAuthJiraTransport,
  JiraClient,
  JiraError,
  normalizeJiraSite,
  oauthJiraTransport,
  setJiraConnection,
  type JiraFetch,
  type JiraTransport
} from '@lawha/core/stories'

import { cloudJiraAvailable, cloudJiraClient } from '@/app/cloud/integration'
import { appCredentialServices } from '@/app/settings/credentials/app'
import { credentialRef } from '@/app/settings/credentials/reference'
import type { CredentialServices } from '@/app/settings/credentials/services'
import { openExternalLink } from '@/app/shell/ui'
import { isTauri } from '@/app/tauri/env'
import { tauriFetch } from '@/app/tauri/http'

/** The API token of the connected site, kept in the system credential store on desktop. */
export const JIRA_API_TOKEN_CREDENTIAL = credentialRef('jira', 'api-token')

/** What is not secret about the connection: the site, the account's email and the project. */
export interface JiraPreferences {
  site: string
  email: string
  /** The project new documents' stories go to; a document can choose its own. */
  projectKey: string
  /**
   * How the site is reached: an API token, or Atlassian's OAuth 2.0 (3LO) through the Home Cloud
   * server, which keeps the refresh token and hands out access tokens.
   */
  auth: 'token' | 'oauth'
}

export const jiraPreferences = useStorage<JiraPreferences>(
  'lawha:jira',
  { site: '', email: '', projectKey: '', auth: 'token' },
  undefined,
  { mergeDefaults: true }
)

/**
 * Where the token lives: the desktop app calls Jira itself with the token from the system
 * credential store; a browser cannot (Jira sends no CORS headers for API tokens), so the Home
 * Cloud server keeps the token and forwards the requests.
 */
export type JiraConnectionMode = 'desktop' | 'cloud' | 'unavailable'

export const jiraConnectionMode = computed<JiraConnectionMode>(() => {
  if (isTauri()) return 'desktop'
  return cloudJiraAvailable.value ? 'cloud' : 'unavailable'
})

/** Whether a site is connected, as last checked; null until the first check finishes. */
export const jiraConnected = ref<boolean | null>(null)

/** Whether the Home Cloud server can connect Jira through Atlassian's OAuth, as last checked. */
export const jiraOAuthAvailable = ref(false)

export type JiraConnectOutcome =
  | 'connected'
  | 'invalid-site'
  | 'rejected'
  | 'unreachable'
  | 'unavailable'
  | 'credential-failed'

/** What the OAuth connection needs from the Home Cloud server. */
export interface JiraOAuthServer {
  authorize(): Promise<string>
  token(): Promise<JiraOAuthToken>
  /** The connection the server keeps, and whether it offers OAuth at all. */
  integration(): Promise<{ connection: JiraConnectionStatus | null; oauth: boolean }>
}

export interface JiraConnectionDeps {
  credentials: CredentialServices
  fetch: JiraFetch
  mode: () => JiraConnectionMode
  /** The Home server's OAuth endpoints; null while nobody is signed in there. */
  oauth?: () => JiraOAuthServer | null
  openURL?: (url: string) => Promise<void>
}

function homeOAuthServer(): JiraOAuthServer | null {
  const client = cloudJiraClient()
  return client
    ? {
        authorize: () => client.authorizeJiraOAuth(),
        token: () => client.jiraOAuthToken(),
        integration: () => client.getJiraIntegration()
      }
    : null
}

const defaultDeps = (): JiraConnectionDeps => ({
  credentials: appCredentialServices,
  // `api.atlassian.com` answers browsers for OAuth tokens, so the web calls it directly.
  fetch: isTauri() ? (input, init) => tauriFetch(input, init) : (input, init) => fetch(input, init),
  mode: () => jiraConnectionMode.value,
  oauth: homeOAuthServer,
  openURL: openExternalLink
})

/** An access token is used until this close to its expiry, then fetched again from the server. */
const OAUTH_TOKEN_MARGIN_MS = 60_000
let oauthToken: JiraOAuthToken | null = null

/**
 * Reaches the site through `api.atlassian.com/ex/jira/{cloudId}` with an access token the Home
 * server hands out and refreshes; the refresh token never leaves the server.
 */
function oauthTransport(deps: JiraConnectionDeps): JiraTransport {
  return async (request) => {
    const server = deps.oauth?.()
    if (!server) throw new JiraError(0, ['Sign in to Lawha Cloud to reach Jira'])
    if (!oauthToken || Date.parse(oauthToken.expiresAt) - OAUTH_TOKEN_MARGIN_MS < Date.now()) {
      oauthToken = await server.token()
    }
    const token = oauthToken
    const response = await oauthJiraTransport({
      cloudId: token.cloudId,
      accessToken: token.accessToken,
      fetch: deps.fetch
    })(request)
    // A token Atlassian revoked early is fetched again on the next request.
    if (response.status === 401) oauthToken = null
    return response
  }
}

function desktopTransport(deps: JiraConnectionDeps, site: string, email: string): JiraTransport {
  // The token is read for each request and never kept in memory between them.
  return async (request) => {
    const apiToken = await deps.credentials.resolver.resolve(JIRA_API_TOKEN_CREDENTIAL)
    if (!apiToken) throw new JiraError(401, ['No Jira API token is saved'])
    return basicAuthJiraTransport({ site, email, apiToken, fetch: deps.fetch })(request)
  }
}

function cloudTransport(): JiraTransport {
  return async (request) => {
    const client = cloudJiraClient()
    if (!client) throw new JiraError(0, ['Sign in to Lawha Cloud to reach Jira'])
    return client.forwardJiraRequest(request)
  }
}

/** The transport for the current mode, or null when Jira cannot be reached from here. */
export function jiraTransport(deps: JiraConnectionDeps = defaultDeps()): JiraTransport | null {
  const site = normalizeJiraSite(jiraPreferences.value.site)
  if (!site) return null
  if (jiraPreferences.value.auth === 'oauth') return deps.oauth?.() ? oauthTransport(deps) : null
  if (deps.mode() === 'desktop') return desktopTransport(deps, site, jiraPreferences.value.email)
  if (deps.mode() === 'cloud') return cloudTransport()
  return null
}

/** Publishes the connection to Core, where the stories' tools find it, or clears it. */
function publish(deps: JiraConnectionDeps = defaultDeps()): void {
  const transport = jiraConnected.value ? jiraTransport(deps) : null
  const site = normalizeJiraSite(jiraPreferences.value.site)
  setJiraConnection(
    transport && site
      ? {
          site,
          client: new JiraClient(transport),
          defaultProjectKey: jiraPreferences.value.projectKey || undefined
        }
      : null
  )
}

/**
 * Checks the site, email and token with Jira (`/rest/api/3/myself`) and keeps them: the token in
 * the credential store on desktop or on the Cloud server on the web, the rest in preferences.
 */
export async function connectJira(
  input: { site: string; email: string; apiToken: string },
  deps: JiraConnectionDeps = defaultDeps()
): Promise<JiraConnectOutcome> {
  const site = normalizeJiraSite(input.site)
  if (!site) return 'invalid-site'
  const email = input.email.trim()
  const apiToken = input.apiToken.trim()
  if (deps.mode() === 'unavailable') return 'unavailable'

  if (deps.mode() === 'cloud') {
    const client = cloudJiraClient()
    if (!client) return 'unavailable'
    try {
      await client.connectJira({ site, email, apiToken })
    } catch (error) {
      return error instanceof Error && 'status' in error && error.status === 422
        ? 'rejected'
        : 'unreachable'
    }
  } else {
    try {
      await new JiraClient(
        basicAuthJiraTransport({ site, email, apiToken, fetch: deps.fetch })
      ).myself()
    } catch (error) {
      return error instanceof JiraError && error.status >= 400 ? 'rejected' : 'unreachable'
    }
    try {
      await deps.credentials.manager.set(JIRA_API_TOKEN_CREDENTIAL, apiToken)
    } catch {
      return 'credential-failed'
    }
  }
  oauthToken = null
  jiraPreferences.value = { ...jiraPreferences.value, site, email, auth: 'token' }
  jiraConnected.value = true
  publish(deps)
  return 'connected'
}

export type JiraOAuthStartOutcome = 'opened' | 'unavailable' | 'failed'

/**
 * Starts connecting through Atlassian's OAuth 2.0 (3LO): opens Atlassian's consent page, which
 * sends the person back to the Home Cloud server once they allow access. The connection shows
 * once `refreshJiraConnection` next reads it, as when the window regains focus.
 */
export async function connectJiraWithAtlassian(
  deps: JiraConnectionDeps = defaultDeps()
): Promise<JiraOAuthStartOutcome> {
  const server = deps.oauth?.()
  if (!server) return 'unavailable'
  let url: string
  try {
    url = await server.authorize()
  } catch {
    return 'failed'
  }
  await deps.openURL?.(url)
  return 'opened'
}

/** Forgets the token, wherever it was kept; the site and email stay for reconnecting. */
export async function disconnectJira(deps: JiraConnectionDeps = defaultDeps()): Promise<void> {
  oauthToken = null
  const oauth = jiraPreferences.value.auth === 'oauth'
  // The Home server holds an OAuth connection, and on the web the API token too.
  if (oauth || deps.mode() === 'cloud') await cloudJiraClient()?.disconnectJira()
  if (oauth) jiraPreferences.value = { ...jiraPreferences.value, auth: 'token' }
  else if (deps.mode() === 'desktop') {
    await deps.credentials.manager.clear(JIRA_API_TOKEN_CREDENTIAL)
  }
  jiraConnected.value = false
  publish(deps)
}

/** Reads whether a site is connected from where the token lives, and publishes it. */
export async function refreshJiraConnection(
  deps: JiraConnectionDeps = defaultDeps()
): Promise<void> {
  // An OAuth connection lives on the Home server, on the desktop as in the browser.
  const integration = await deps
    .oauth?.()
    ?.integration()
    .catch(() => null)
  jiraOAuthAvailable.value = integration?.oauth ?? false
  if (integration?.connection?.kind === 'oauth') {
    jiraPreferences.value = {
      ...jiraPreferences.value,
      site: integration.connection.site,
      auth: 'oauth'
    }
    jiraConnected.value = true
    publish(deps)
    return
  }
  if (jiraPreferences.value.auth === 'oauth') {
    jiraPreferences.value = { ...jiraPreferences.value, auth: 'token' }
  }
  if (deps.mode() === 'desktop') {
    const status = await deps.credentials.manager.status(JIRA_API_TOKEN_CREDENTIAL)
    jiraConnected.value = status === 'configured' && !!normalizeJiraSite(jiraPreferences.value.site)
  } else if (deps.mode() === 'cloud') {
    const status = integration?.connection ?? null
    if (status)
      jiraPreferences.value = { ...jiraPreferences.value, site: status.site, email: status.email }
    jiraConnected.value = !!status
  } else {
    jiraConnected.value = false
  }
  publish(deps)
}

/** Keeps Core's connection in step with preferences and Cloud sign-in; returns the stop. */
export function startJiraConnection(): () => void {
  void refreshJiraConnection().catch((error: unknown) =>
    console.warn('[Jira] Could not read the connection:', error)
  )
  const stopMode = watch(
    jiraConnectionMode,
    () => void refreshJiraConnection().catch(() => undefined)
  )
  const stopHome = watch(
    () => cloudJiraAvailable.value,
    () => void refreshJiraConnection().catch(() => undefined)
  )
  // Coming back from Atlassian's consent page shows the connection it made.
  const focused = () => void refreshJiraConnection().catch(() => undefined)
  window.addEventListener('focus', focused)
  const stopProject = watch(
    () => jiraPreferences.value.projectKey,
    () => publish()
  )
  return () => {
    stopMode()
    stopHome()
    window.removeEventListener('focus', focused)
    stopProject()
  }
}
