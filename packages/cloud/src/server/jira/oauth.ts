import { JIRA_OAUTH_CALLBACK_PATH, JIRA_OAUTH_SCOPES } from '#cloud/contract'
import { withQuery } from 'ufo'
import * as v from 'valibot'

/** Atlassian's OAuth 2.0 (3LO) endpoints, from developer.atlassian.com's 3LO guide. */
export const ATLASSIAN_AUTHORIZE_URL = 'https://auth.atlassian.com/authorize'
export const ATLASSIAN_TOKEN_URL = 'https://auth.atlassian.com/oauth/token'
export const ATLASSIAN_RESOURCES_URL = 'https://api.atlassian.com/oauth/token/accessible-resources'
/** Where a site's REST API is reached with an OAuth token. */
export const ATLASSIAN_JIRA_API_URL = 'https://api.atlassian.com/ex/jira'

const OAUTH_TIMEOUT_MS = 20_000
const jsonSchema = v.pipe(v.string(), v.parseJson())

export type AtlassianOAuthApp = { clientId: string; clientSecret: string; publicURL: string }
export type AtlassianFetch = (input: string, init: RequestInit) => Promise<Response>

const tokenResponseSchema = v.object({
  access_token: v.pipe(v.string(), v.nonEmpty()),
  expires_in: v.pipe(v.number(), v.minValue(1)),
  refresh_token: v.optional(v.string()),
  scope: v.optional(v.string())
})
export type AtlassianTokens = {
  accessToken: string
  /** Atlassian rotates refresh tokens: each refresh answers with the next one. */
  refreshToken: string | null
  expiresAt: Date
}

const resourcesSchema = v.array(
  v.object({
    id: v.pipe(v.string(), v.nonEmpty()),
    url: v.string(),
    name: v.fallback(v.string(), ''),
    scopes: v.fallback(v.array(v.string()), [])
  })
)
export type AtlassianResource = v.InferOutput<typeof resourcesSchema>[number]

export function oauthRedirectURI(app: AtlassianOAuthApp): string {
  return new URL(JIRA_OAUTH_CALLBACK_PATH, app.publicURL).href
}

/** The consent page for `state`; `prompt=consent` so a refresh token is always issued. */
export function atlassianAuthorizeURL(app: AtlassianOAuthApp, state: string): string {
  return withQuery(ATLASSIAN_AUTHORIZE_URL, {
    audience: 'api.atlassian.com',
    client_id: app.clientId,
    scope: JIRA_OAUTH_SCOPES.join(' '),
    redirect_uri: oauthRedirectURI(app),
    state,
    response_type: 'code',
    prompt: 'consent'
  })
}

async function readJSON(response: Response): Promise<unknown> {
  const parsed = v.safeParse(jsonSchema, await response.text())
  return parsed.success ? parsed.output : null
}

async function requestTokens(
  fetcher: AtlassianFetch,
  body: Record<string, string>
): Promise<AtlassianTokens | null> {
  const response = await fetcher(ATLASSIAN_TOKEN_URL, {
    method: 'POST',
    redirect: 'manual',
    signal: AbortSignal.timeout(OAUTH_TIMEOUT_MS),
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!response.ok) return null
  const parsed = v.safeParse(tokenResponseSchema, await readJSON(response))
  if (!parsed.success) return null
  return {
    accessToken: parsed.output.access_token,
    refreshToken: parsed.output.refresh_token ?? null,
    expiresAt: new Date(Date.now() + parsed.output.expires_in * 1000)
  }
}

/** Trades the code Atlassian sent back for tokens; null when Atlassian refuses it. */
export function exchangeAuthorizationCode(
  app: AtlassianOAuthApp,
  fetcher: AtlassianFetch,
  code: string
): Promise<AtlassianTokens | null> {
  return requestTokens(fetcher, {
    grant_type: 'authorization_code',
    client_id: app.clientId,
    client_secret: app.clientSecret,
    code,
    redirect_uri: oauthRedirectURI(app)
  })
}

/** A new access token, and the next refresh token, for a refresh token. */
export function refreshAccessToken(
  app: AtlassianOAuthApp,
  fetcher: AtlassianFetch,
  refreshToken: string
): Promise<AtlassianTokens | null> {
  return requestTokens(fetcher, {
    grant_type: 'refresh_token',
    client_id: app.clientId,
    client_secret: app.clientSecret,
    refresh_token: refreshToken
  })
}

/**
 * The Jira site the token reaches: Atlassian lists every site the person allowed, each with its
 * cloud ID; the first with Jira's scopes is the one connected.
 */
export async function discoverJiraSite(
  fetcher: AtlassianFetch,
  accessToken: string
): Promise<AtlassianResource | null> {
  const response = await fetcher(ATLASSIAN_RESOURCES_URL, {
    method: 'GET',
    redirect: 'manual',
    signal: AbortSignal.timeout(OAUTH_TIMEOUT_MS),
    headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` }
  })
  if (!response.ok) return null
  const parsed = v.safeParse(resourcesSchema, await readJSON(response))
  if (!parsed.success) return null
  return (
    parsed.output.find((resource) =>
      resource.scopes.some((scope) => scope.endsWith(':jira-work'))
    ) ??
    parsed.output[0] ??
    null
  )
}
