import type { Page } from '@playwright/test'
import * as v from 'valibot'

import { cloudDiscoveryFixture } from '#tests/helpers/cloud/discovery'

const CLOUD = 'https://cloud.example.com'
const ACCOUNT = { id: 'user-1', name: 'Ada', email: 'ada@example.com' }
export const JIRA_SITE = 'https://lawha-test.atlassian.net'

interface FakeIssue {
  key: string
  fields: Record<string, unknown>
  status: { name: string; category: string }
  assignee: string | null
}

/** One request the stories sent to Jira through the Cloud server. */
export interface ForwardedJiraRequest {
  method: string
  path: string
  body: unknown
}

const forwardSchema = v.object({
  method: v.string(),
  path: v.string(),
  body: v.optional(v.unknown())
})
const fieldsSchema = v.object({ fields: v.record(v.string(), v.unknown()) })
const searchSchema = v.object({ jql: v.string() })

/**
 * A Cloud server on Home with Ada's Jira site connected by API token, forwarding the stories'
 * requests to an in-memory Jira Cloud site that answers the REST v3 endpoints as documented.
 * `fail` makes the site answer the next matching requests with an error status instead.
 */
export async function routeCloudJira(page: Page, appOrigin: string) {
  const issues = new Map<string, FakeIssue>()
  const forwarded: ForwardedJiraRequest[] = []
  const failures: Array<{ path: RegExp; status: number }> = []
  let next = 1

  /** Answers `/search/jql` as Jira Cloud does: 400 when none of the keys is found. */
  function search(body: unknown): { status: number; body: unknown } {
    const { jql } = v.parse(searchSchema, body)
    const keys = /key in \(([^)]*)\)/.exec(jql)?.[1].split(',') ?? []
    const found = keys.flatMap((key) => {
      const issue = issues.get(key)
      return issue ? [issue] : []
    })
    if (found.length === 0) {
      return { status: 400, body: { errorMessages: ['No issue of the list exists'] } }
    }
    return {
      status: 200,
      body: {
        issues: found.map((issue) => ({
          key: issue.key,
          fields: {
            summary: issue.fields.summary,
            updated: '2026-11-11T10:00:00.000+0000',
            status: { name: issue.status.name, statusCategory: { key: issue.status.category } },
            assignee: issue.assignee ? { displayName: issue.assignee } : null
          }
        }))
      }
    }
  }

  function create(body: unknown): { status: number; body: unknown } {
    const { fields } = v.parse(fieldsSchema, body)
    const key = `SHOP-${next++}`
    issues.set(key, { key, fields, status: { name: 'To Do', category: 'new' }, assignee: null })
    return { status: 201, body: { id: String(10000 + next), key } }
  }

  function update(key: string, body: unknown): { status: number; body: unknown } {
    const issue = issues.get(key)
    if (!issue) return { status: 404, body: { errorMessages: ['Issue does not exist'] } }
    issue.fields = { ...issue.fields, ...v.parse(fieldsSchema, body).fields }
    return { status: 204, body: null }
  }

  function jira({ method, path, body }: ForwardedJiraRequest): { status: number; body: unknown } {
    const failure = failures.findIndex((entry) => entry.path.test(path))
    if (failure !== -1) {
      const [{ status }] = failures.splice(failure, 1)
      return { status, body: status === 429 ? null : { errorMessages: [`Refused ${status}`] } }
    }
    const route = `${method} ${path.split('?')[0]}`
    const issueKey = /^PUT \/rest\/api\/3\/issue\/([A-Z]+-\d+)$/.exec(route)?.[1]
    if (issueKey) return update(issueKey, body)
    switch (route) {
      case 'GET /rest/api/3/myself':
        return { status: 200, body: { accountId: 'acc-1', displayName: 'Ada' } }
      case 'GET /rest/api/3/project/search':
        return {
          status: 200,
          body: { values: [{ id: '1', key: 'SHOP', name: 'متجر', style: 'next-gen' }] }
        }
      case 'GET /rest/api/3/issue/createmeta/SHOP/issuetypes':
        return {
          status: 200,
          body: {
            issueTypes: [
              { id: '10120', name: 'Task', subtask: false, hierarchyLevel: 0 },
              { id: '10121', name: 'Epic', subtask: false, hierarchyLevel: 1 }
            ]
          }
        }
      case 'GET /rest/api/3/issue/createmeta/SHOP/issuetypes/10120':
        return { status: 200, body: { fields: [] } }
      case 'POST /rest/api/3/issue':
        return create(body)
      case 'POST /rest/api/3/search/jql':
        return search(body)
      default:
        return { status: 404, body: { errorMessages: [`No route for ${method} ${path}`] } }
    }
  }

  const cloud: Record<string, (body: unknown) => unknown> = {
    'GET /.well-known/lawha': () => cloudDiscoveryFixture(CLOUD),
    'GET /api/account/status': () => ({
      user: { userId: ACCOUNT.id, email: ACCOUNT.email, name: ACCOUNT.name },
      state: 'active'
    }),
    'GET /api/workspaces': () => ({ workspaces: [] }),
    'GET /api/integrations/jira': () => ({
      connection: {
        kind: 'token',
        site: JIRA_SITE,
        email: ACCOUNT.email,
        updatedAt: '2026-11-01T00:00:00.000Z'
      },
      oauth: false
    }),
    'POST /api/integrations/jira/request': (body) => {
      const request = v.parse(forwardSchema, body)
      forwarded.push({ method: request.method, path: request.path, body: request.body })
      return jira({ method: request.method, path: request.path, body: request.body })
    }
  }

  const unexpected: string[] = []
  await page.route(`${CLOUD}/**`, async (route) => {
    const request = route.request()
    const headers = {
      'Access-Control-Allow-Origin': appOrigin,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
    }
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    const answer = cloud[`${request.method()} ${new URL(request.url()).pathname}`]
    if (!answer) {
      unexpected.push(`${request.method()} ${request.url()}`)
      return route.fulfill({ status: 404, headers, json: { error: { code: 'not_found' } } })
    }
    const text = request.postData()
    const body = text ? v.parse(v.pipe(v.string(), v.parseJson()), text) : undefined
    return route.fulfill({ headers, json: answer(body) })
  })

  return {
    issues,
    forwarded,
    unexpected,
    /** The site answers the next request whose path matches with `status`. */
    fail(path: RegExp, status: number) {
      failures.push({ path, status })
    }
  }
}
