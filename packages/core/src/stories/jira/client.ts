import { encode } from 'js-base64'
import * as v from 'valibot'

/** One call to Jira Cloud's REST API: a path under the site, such as `/rest/api/3/myself`. */
export interface JiraRequest {
  method: 'GET' | 'POST' | 'PUT'
  path: string
  body?: unknown
}

export interface JiraResponse {
  status: number
  /** The parsed JSON body, or null when there was none. */
  body: unknown
}

/**
 * Sends a request to the connected site and returns its answer. Hosts supply it: basic auth
 * with an API token on desktop, a Lawha Cloud server that holds the token on the web, or an
 * OAuth bearer token through `api.atlassian.com`.
 */
export type JiraTransport = (request: JiraRequest) => Promise<JiraResponse>

export type JiraFetch = (input: string, init: RequestInit) => Promise<Response>

/** The REST paths Lawha calls; transports and proxies refuse any other. */
export const JIRA_API_PATH_PATTERN =
  /^\/rest\/api\/3\/(myself|project\/search(\?[^#]*)?|project\/[A-Za-z0-9_]+|issue\/createmeta\/[A-Za-z0-9_]+\/issuetypes(\?[^#]*)?|issue|issue\/[A-Z][A-Z0-9_]*-\d+|search\/jql)$/

export function isJiraAPIPath(path: string): boolean {
  return JIRA_API_PATH_PATTERN.test(path)
}

const jsonSchema = v.pipe(v.string(), v.parseJson())

/** Reads a fetch response as a Jira response: status and JSON body, or null for none. */
export async function readJiraResponse(response: Response): Promise<JiraResponse> {
  const text = await response.text()
  if (!text) return { status: response.status, body: null }
  const parsed = v.safeParse(jsonSchema, text)
  return { status: response.status, body: parsed.success ? parsed.output : null }
}

async function send(
  fetch: JiraFetch,
  url: string,
  authorization: string,
  request: JiraRequest
): Promise<JiraResponse> {
  if (!isJiraAPIPath(request.path)) throw new JiraError(0, [`Refused Jira path ${request.path}`])
  const response = await fetch(url, {
    method: request.method,
    headers: {
      Accept: 'application/json',
      Authorization: authorization,
      ...(request.body === undefined ? {} : { 'Content-Type': 'application/json' })
    },
    body: request.body === undefined ? undefined : JSON.stringify(request.body)
  })
  return readJiraResponse(response)
}

/** A site address as Jira Cloud serves it: `https://<name>.atlassian.net`, without a path. */
export function normalizeJiraSite(site: string): string | null {
  let url: URL
  try {
    url = new URL(site.includes('://') ? site : `https://${site}`)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.username || url.password) return null
  return url.origin
}

/**
 * A site reached with an account's email and API token (basic auth), as Atlassian's docs
 * describe for scripts and integrations: https://id.atlassian.com/manage-profile/security/api-tokens.
 */
export function basicAuthJiraTransport(options: {
  site: string
  email: string
  apiToken: string
  fetch: JiraFetch
}): JiraTransport {
  const site = normalizeJiraSite(options.site)
  if (!site) throw new JiraError(0, ['The Jira site address is not valid'])
  const authorization = `Basic ${encode(`${options.email}:${options.apiToken}`)}`
  return (request) => send(options.fetch, `${site}${request.path}`, authorization, request)
}

/** A site reached with an OAuth 2.0 (3LO) access token, through `api.atlassian.com`. */
export function oauthJiraTransport(options: {
  cloudId: string
  accessToken: string
  fetch: JiraFetch
}): JiraTransport {
  const base = `https://api.atlassian.com/ex/jira/${encodeURIComponent(options.cloudId)}`
  return (request) =>
    send(options.fetch, `${base}${request.path}`, `Bearer ${options.accessToken}`, request)
}

/** A request Jira refused or could not answer, with the messages it gave. */
export class JiraError extends Error {
  constructor(
    readonly status: number,
    readonly messages: string[]
  ) {
    super(messages.length > 0 ? messages.join(' ') : `Jira answered ${status}`)
    this.name = 'JiraError'
  }
}

const jiraErrorBodySchema = v.object({
  errorMessages: v.fallback(v.array(v.string()), []),
  errors: v.fallback(v.record(v.string(), v.string()), {})
})

function failure(response: JiraResponse): JiraError {
  const parsed = v.safeParse(jiraErrorBodySchema, response.body)
  const messages = parsed.success
    ? [
        ...parsed.output.errorMessages,
        ...Object.entries(parsed.output.errors).map(([field, message]) => `${field}: ${message}`)
      ]
    : []
  return new JiraError(response.status, messages)
}

const myselfSchema = v.object({ accountId: v.string(), displayName: v.fallback(v.string(), '') })

const projectSchema = v.object({
  id: v.string(),
  key: v.string(),
  name: v.string(),
  /** `classic` for company-managed projects, `next-gen` for team-managed ones. */
  style: v.fallback(v.optional(v.string()), undefined),
  simplified: v.fallback(v.optional(v.boolean()), undefined)
})
export type JiraProject = v.InferOutput<typeof projectSchema>

const projectPageSchema = v.object({ values: v.array(projectSchema) })

const issueTypeSchema = v.object({
  id: v.string(),
  name: v.string(),
  subtask: v.fallback(v.boolean(), false),
  /** 1 for Epic, 0 for Story, Task and Bug, -1 for sub-tasks; custom levels go higher. */
  hierarchyLevel: v.fallback(v.optional(v.number()), undefined)
})
export type JiraIssueType = v.InferOutput<typeof issueTypeSchema>

const issueTypePageSchema = v.union([
  v.object({ issueTypes: v.array(issueTypeSchema) }),
  v.object({ values: v.array(issueTypeSchema) })
])

const createdIssueSchema = v.object({ id: v.string(), key: v.string() })

const issueSchema = v.object({
  key: v.string(),
  fields: v.object({
    summary: v.fallback(v.optional(v.string()), undefined),
    updated: v.fallback(v.optional(v.string()), undefined),
    status: v.fallback(
      v.optional(
        v.object({
          name: v.string(),
          statusCategory: v.fallback(v.optional(v.object({ key: v.string() })), undefined)
        })
      ),
      undefined
    ),
    assignee: v.fallback(v.nullish(v.object({ displayName: v.string() })), null)
  })
})
export type JiraIssue = v.InferOutput<typeof issueSchema>

const searchPageSchema = v.object({
  issues: v.array(issueSchema),
  nextPageToken: v.fallback(v.optional(v.string()), undefined)
})

/** Jira Cloud's REST API v3 as the stories use it. */
export class JiraClient {
  constructor(readonly transport: JiraTransport) {}

  private async call<T>(
    request: JiraRequest,
    schema: v.GenericSchema<unknown, T>,
    ok: (status: number) => boolean = (status) => status >= 200 && status < 300
  ): Promise<T> {
    const response = await this.transport(request)
    if (!ok(response.status)) throw failure(response)
    const parsed = v.safeParse(schema, response.body)
    if (!parsed.success) throw new JiraError(response.status, ['Jira sent an unexpected answer'])
    return parsed.output
  }

  /** The account the connection acts as; also how a connection is tested. */
  myself() {
    return this.call({ method: 'GET', path: '/rest/api/3/myself' }, myselfSchema)
  }

  async searchProjects(query = ''): Promise<JiraProject[]> {
    const params = new URLSearchParams({ maxResults: '50', orderBy: 'name' })
    if (query) params.set('query', query)
    const page = await this.call(
      { method: 'GET', path: `/rest/api/3/project/search?${params}` },
      projectPageSchema
    )
    return page.values
  }

  project(key: string): Promise<JiraProject> {
    return this.call({ method: 'GET', path: `/rest/api/3/project/${key}` }, projectSchema)
  }

  /** The issue types a project can create, as `createmeta` lists them for that project. */
  async issueTypes(projectKey: string): Promise<JiraIssueType[]> {
    const page = await this.call(
      {
        method: 'GET',
        path: `/rest/api/3/issue/createmeta/${projectKey}/issuetypes?maxResults=200`
      },
      issueTypePageSchema
    )
    return 'issueTypes' in page ? page.issueTypes : page.values
  }

  createIssue(fields: Record<string, unknown>): Promise<{ id: string; key: string }> {
    return this.call(
      { method: 'POST', path: '/rest/api/3/issue', body: { fields } },
      createdIssueSchema
    )
  }

  async updateIssue(key: string, fields: Record<string, unknown>): Promise<void> {
    await this.call(
      { method: 'PUT', path: `/rest/api/3/issue/${key}`, body: { fields } },
      v.unknown()
    )
  }

  /** The issues with these keys, with their status and assignee, a page at a time. */
  async issues(keys: readonly string[]): Promise<JiraIssue[]> {
    const found: JiraIssue[] = []
    for (let start = 0; start < keys.length; start += 100) {
      const chunk = keys.slice(start, start + 100)
      let nextPageToken: string | undefined
      do {
        const page = await this.call(
          {
            method: 'POST',
            path: '/rest/api/3/search/jql',
            body: {
              jql: `key in (${chunk.join(',')})`,
              fields: ['summary', 'status', 'assignee', 'updated'],
              maxResults: 100,
              ...(nextPageToken ? { nextPageToken } : {})
            }
          },
          searchPageSchema
        )
        found.push(...page.issues)
        nextPageToken = page.nextPageToken
      } while (nextPageToken)
    }
    return found
  }
}

/** The issue types stories and epics become in a project, whichever way it is managed. */
export interface StoryIssueTypes {
  epic: JiraIssueType | null
  story: JiraIssueType | null
}

/**
 * Picks the Epic and Story types from a project's issue types. Team-managed projects give each
 * project its own type ids, and either kind of project may rename them, so the hierarchy level
 * decides (1 is the epic level, 0 the standard level), and the names only break ties.
 */
export function pickStoryIssueTypes(types: readonly JiraIssueType[]): StoryIssueTypes {
  const usable = types.filter((type) => !type.subtask)
  const byName = (list: JiraIssueType[], names: string[]) =>
    names.map((name) => list.find((type) => type.name.toLowerCase() === name)).find(Boolean) ??
    list.at(0) ??
    null
  const epics = usable.filter(
    (type) =>
      type.hierarchyLevel === 1 || (type.hierarchyLevel === undefined && type.name === 'Epic')
  )
  const standard = usable.filter(
    (type) =>
      type.hierarchyLevel === 0 || (type.hierarchyLevel === undefined && type.name !== 'Epic')
  )
  return { epic: byName(epics, ['epic']), story: byName(standard, ['story', 'task']) }
}

/** An issue's address on its site. */
export function jiraIssueURL(site: string, key: string): string {
  return `${normalizeJiraSite(site) ?? site}/browse/${key}`
}
