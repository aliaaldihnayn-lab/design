import * as v from 'valibot'

/**
 * A Jira Cloud site connected for the person's user stories. On the web the browser cannot call
 * Jira itself (Jira sends no CORS headers for API tokens), so the server holds the site, email
 * and API token, encrypted, and forwards the few REST v3 requests the stories make. The token
 * never travels back to the client.
 */

/** The REST paths the server forwards; any other path is refused. */
export const JIRA_FORWARDED_PATH_PATTERN =
  /^\/rest\/api\/3\/(myself|project\/search(\?[^#]*)?|project\/[A-Za-z0-9_]+|issue\/createmeta\/[A-Za-z0-9_]+\/issuetypes(\?[^#]*)?|issue|issue\/[A-Z][A-Z0-9_]*-\d+|search\/jql)$/

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

/** What the server tells the client about its connection: never the token. */
export const jiraConnectionSchema = v.object({
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
