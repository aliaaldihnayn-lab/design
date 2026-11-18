import * as v from 'valibot'

import type { JiraCreateField, JiraFetch, JiraIssueType } from '@lawha/core/stories'

/** A call the fake site received, with its parsed JSON body. */
export interface ReceivedCall {
  method: string
  url: string
  authorization: string | null
  body: unknown
}

interface StoredIssue {
  key: string
  fields: Record<string, unknown>
  status: { name: string; category: string }
  assignee: string | null
}

const bodySchema = v.pipe(v.string(), v.parseJson())
const fieldsSchema = v.object({ fields: v.record(v.string(), v.unknown()) })
const searchSchema = v.object({ jql: v.string() })

/**
 * An in-memory Jira Cloud site answering the REST v3 endpoints the stories call, the way the
 * official API documents them, so tests run the real client over a mocked HTTP layer.
 */
export function fakeJira(options: {
  projectKey: string
  issueTypes: JiraIssueType[]
  /** The fields on each issue type's create screen, by type id; Jira refuses any other. */
  createFields?: Record<string, JiraCreateField[]>
}) {
  const calls: ReceivedCall[] = []
  const issues = new Map<string, StoredIssue>()
  let next = 1
  const json = (status: number, body?: unknown) =>
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' }
    })

  function create(url: URL, body: unknown): Response {
    const { fields } = v.parse(fieldsSchema, body)
    const summary = fields.summary
    if (typeof summary !== 'string' || summary.length === 0) {
      return json(400, {
        errorMessages: [],
        errors: { summary: 'You must specify a summary of the issue.' }
      })
    }
    const typeId = v.parse(v.object({ id: v.string() }), fields.issuetype).id
    const screen = options.createFields?.[typeId]
    const offScreen = screen
      ? Object.keys(fields).filter(
          (name) =>
            !['summary', 'description', 'project', 'issuetype', 'parent'].includes(name) &&
            !screen.some((field) => field.fieldId === name)
        )
      : []
    if (offScreen.length > 0) {
      return json(400, {
        errorMessages: [],
        errors: Object.fromEntries(
          offScreen.map((name) => [
            name,
            `Field '${name}' cannot be set. It is not on the appropriate screen, or unknown.`
          ])
        )
      })
    }
    const key = `${options.projectKey}-${next++}`
    issues.set(key, { key, fields, status: { name: 'To Do', category: 'new' }, assignee: null })
    return json(201, {
      id: String(10000 + next),
      key,
      self: `${url.origin}/rest/api/3/issue/${key}`
    })
  }

  function search(body: unknown): Response {
    const { jql } = v.parse(searchSchema, body)
    const keys = /key in \(([^)]*)\)/.exec(jql)?.[1].split(',') ?? []
    return json(200, {
      issues: keys.flatMap((key) => {
        const issue = issues.get(key)
        if (!issue) return []
        return [
          {
            key,
            fields: {
              summary: issue.fields.summary,
              updated: '2026-11-11T10:00:00.000+0000',
              status: { name: issue.status.name, statusCategory: { key: issue.status.category } },
              assignee: issue.assignee ? { displayName: issue.assignee } : null
            }
          }
        ]
      })
    })
  }

  /** An issue type's create screen, as `createmeta` lists its fields. */
  function createScreen(path: string): Response | null {
    const match = new RegExp(
      `^/rest/api/3/issue/createmeta/${options.projectKey}/issuetypes/(\\d+)$`
    ).exec(path)
    if (!match) return null
    const fields = options.createFields?.[match[1]] ?? []
    return json(200, { fields, maxResults: 200, startAt: 0, total: fields.length })
  }

  const fetch: JiraFetch = (input, init) => Promise.resolve(answer(input, init))

  function answer(input: string, init: RequestInit): Response {
    const url = new URL(input)
    const text = typeof init.body === 'string' ? init.body : ''
    const parsed = text ? v.safeParse(bodySchema, text) : undefined
    const body = parsed?.success ? parsed.output : undefined
    const headers = new Headers(init.headers)
    const method = init.method ?? 'GET'
    calls.push({ method, url: url.toString(), authorization: headers.get('Authorization'), body })
    const path = url.pathname

    if (method === 'GET' && path === '/rest/api/3/myself') {
      return json(200, { accountId: 'acc-1', displayName: 'Sara' })
    }
    if (
      method === 'GET' &&
      path === `/rest/api/3/issue/createmeta/${options.projectKey}/issuetypes`
    ) {
      return json(200, { issueTypes: options.issueTypes, maxResults: 200, startAt: 0, total: 1 })
    }
    const screen = method === 'GET' ? createScreen(path) : null
    if (screen) return screen
    if (method === 'POST' && path === '/rest/api/3/issue') return create(url, body)
    const issueMatch = /^\/rest\/api\/3\/issue\/([A-Z][A-Z0-9_]*-\d+)$/.exec(path)
    if (method === 'PUT' && issueMatch) {
      const issue = issues.get(issueMatch[1])
      if (!issue)
        return json(404, {
          errorMessages: ['Issue does not exist or you do not have permission to see it.']
        })
      issue.fields = { ...issue.fields, ...v.parse(fieldsSchema, body).fields }
      return json(204)
    }
    if (method === 'POST' && path === '/rest/api/3/search/jql') return search(body)
    return json(404, { errorMessages: [`No route for ${method} ${path}`] })
  }

  return { fetch, calls, issues }
}

/** Company-managed (classic) projects share global ids and name their types Epic and Story. */
export const COMPANY_MANAGED_TYPES: JiraIssueType[] = [
  { id: '10000', name: 'Epic', subtask: false, hierarchyLevel: 1 },
  { id: '10001', name: 'Story', subtask: false, hierarchyLevel: 0 },
  { id: '10002', name: 'Task', subtask: false, hierarchyLevel: 0 },
  { id: '10003', name: 'Sub-task', subtask: true, hierarchyLevel: -1 }
]

/** Team-managed (next-gen) projects have their own ids and may rename the types. */
export const TEAM_MANAGED_TYPES: JiraIssueType[] = [
  { id: '10120', name: 'Task', subtask: false, hierarchyLevel: 0 },
  { id: '10121', name: 'Feature', subtask: false, hierarchyLevel: 1 },
  { id: '10122', name: 'Subtask', subtask: true, hierarchyLevel: -1 }
]
