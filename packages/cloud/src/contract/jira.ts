import * as v from 'valibot'

/**
 * A Jira Cloud site connected for the person's user stories. On the web the browser cannot call
 * Jira itself (Jira sends no CORS headers for API tokens), so the server holds the site, email
 * and API token, encrypted, and forwards the few REST v3 requests the stories make. The token
 * never travels back to the client.
 */

/** The REST paths the server forwards; any other path is refused. */
export const JIRA_FORWARDED_PATH_PATTERN =
  /^\/rest\/api\/3\/(myself|project\/search(\?[^#]*)?|project\/[A-Za-z0-9_]+|issue\/createmeta\/[A-Za-z0-9_]+\/issuetypes(\/[0-9]+)?(\?[^#]*)?|issue|issue\/[A-Z][A-Z0-9_]*-\d+|search\/jql)$/

const siteSchema = v.pipe(
  v.string(),
  v.trim(),
  v.maxLength(500),
  v.url(),
  v.check((value) => {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password
  }, 'Expected an https site address')
)

export const jiraConnectionInputSchema = v.object({
  site: siteSchema,
  email: v.pipe(v.string(), v.trim(), v.email(), v.maxLength(320)),
  apiToken: v.pipe(v.string(), v.trim(), v.nonEmpty(), v.maxLength(4096))
})
export type JiraConnectionInput = v.InferOutput<typeof jiraConnectionInputSchema>

/**
 * What the server tells the client about its connection: never a token. `token` connections use
 * the account's email and API token; `oauth` ones were authorized through Atlassian's OAuth 2.0
 * (3LO), and their email is empty.
 */
export const jiraConnectionSchema = v.object({
  kind: v.optional(v.picklist(['token', 'oauth']), 'token'),
  site: v.string(),
  email: v.string(),
  updatedAt: v.pipe(v.string(), v.isoTimestamp())
})
export type JiraConnectionStatus = v.InferOutput<typeof jiraConnectionSchema>

export const jiraForwardRequestSchema = v.object({
  method: v.picklist(['GET', 'POST', 'PUT']),
  path: v.pipe(v.string(), v.maxLength(2000), v.regex(JIRA_FORWARDED_PATH_PATTERN)),
  body: v.optional(v.unknown())
})
export type JiraForwardRequest = v.InferOutput<typeof jiraForwardRequestSchema>

export const jiraForwardResponseSchema = v.object({
  status: v.pipe(v.number(), v.integer()),
  body: v.unknown()
})
export type JiraForwardResponse = v.InferOutput<typeof jiraForwardResponseSchema>

/**
 * Where Atlassian sends the person back after they allow access. It is public, since the
 * authorizing browser may hold no session here; the single-use `state` names who started it.
 */
export const JIRA_OAUTH_CALLBACK_PATH = '/api/public/integrations/jira/oauth/callback'

/** What Lawha asks Atlassian for: reading and writing issues, the account, and a refresh token. */
export const JIRA_OAUTH_SCOPES = [
  'read:jira-work',
  'write:jira-work',
  'read:jira-user',
  'offline_access'
] as const

/** The page at Atlassian where the person allows Lawha to reach their Jira site. */
export const jiraOAuthAuthorizationSchema = v.object({ url: v.pipe(v.string(), v.url()) })
export type JiraOAuthAuthorization = v.InferOutput<typeof jiraOAuthAuthorizationSchema>

/**
 * A short-lived access token for the connected site, which the client sends straight to
 * `api.atlassian.com/ex/jira/{cloudId}`. The refresh token never leaves the server.
 */
export const jiraOAuthTokenSchema = v.object({
  accessToken: v.pipe(v.string(), v.nonEmpty()),
  cloudId: v.pipe(v.string(), v.nonEmpty()),
  site: v.string(),
  expiresAt: v.pipe(v.string(), v.isoTimestamp())
})
export type JiraOAuthToken = v.InferOutput<typeof jiraOAuthTokenSchema>

/** How the callback ends, as the query of the page it sends the person to. */
export const JIRA_OAUTH_RESULT_PARAM = 'jira'
