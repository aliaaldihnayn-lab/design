import { describe, expect, test } from 'bun:test'

import {
  JiraClient,
  pullFromJira,
  pushToJira,
  type JiraRequest,
  type JiraResponse
} from '@lawha/core/stories'
import { SceneGraph } from '@lawha/scene-graph'
import { addStory, createUserStory, updateStory } from '@lawha/scene-graph/stories'

import { jiraFailure, summarizeJiraSync } from '@/app/stories/jira'

const SITE = 'https://lawha-test.atlassian.net'

/** A site that knows the project's types and answers every other request with `status`. */
function refusingSite(status: number, body: unknown = null) {
  return new JiraClient(async (request: JiraRequest): Promise<JiraResponse> => {
    if (request.path.startsWith('/rest/api/3/issue/createmeta/SHOP/issuetypes?')) {
      return {
        status: 200,
        body: { issueTypes: [{ id: '1', name: 'Story', subtask: false, hierarchyLevel: 0 }] }
      }
    }
    return { status, body }
  })
}

function screen() {
  const graph = new SceneGraph()
  const [page] = graph.getPages()
  const frame = graph.createNode('FRAME', page.id, { name: 'الدفع' })
  const story = addStory(graph, frame.id, createUserStory({ title: 'ادفع' }))
  return { graph, frame, story }
}

describe('Jira failures in the Stories tab', () => {
  test('a refused sync says what the person can do, by what Jira answered', async () => {
    const { graph, frame, story } = screen()
    updateStory(graph, frame.id, story.id, { jiraKey: 'SHOP-1' })
    const kinds: Record<number, string> = {}
    for (const status of [401, 403, 404, 429, 502]) {
      const error = await pullFromJira(graph, refusingSite(status)).catch((e: unknown) => e)
      kinds[status] = jiraFailure(error).kind
    }
    expect(kinds).toEqual({
      401: 'auth',
      403: 'forbidden',
      404: 'not-found',
      429: 'rate-limited',
      502: 'unreachable'
    })
    // A search Jira refuses for its one key reports that issue rather than failing the pull.
    const gone = summarizeJiraSync(await pullFromJira(graph, refusingSite(400)))
    expect(gone).toMatchObject({ failed: 1, firstError: { kind: 'refused' } })
    expect(jiraFailure(new TypeError('Failed to fetch')).kind).toBe('unreachable')
  })

  test('an item Jira refused keeps its status and its message', async () => {
    const { graph } = screen()
    const result = await pushToJira(
      graph,
      refusingSite(403, { errorMessages: ['You cannot create issues in SHOP.'] }),
      { site: SITE, projectKey: 'SHOP' }
    )
    expect(summarizeJiraSync(result)).toMatchObject({
      created: 0,
      failed: 1,
      firstError: { kind: 'forbidden', detail: 'You cannot create issues in SHOP.' }
    })
  })
})
