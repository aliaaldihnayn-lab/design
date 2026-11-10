import { describe, expect, test } from 'bun:test'

import {
  COMPANY_MANAGED_TYPES,
  fakeJira,
  TEAM_MANAGED_TYPES
} from '#core-tests/stories/jira/fake-jira'
import { encode } from 'js-base64'

import {
  applyJiraUpdates,
  basicAuthJiraTransport,
  isJiraAPIPath,
  JiraClient,
  JiraError,
  pickStoryIssueTypes,
  pullFromJira,
  pushToJira,
  storyDescription
} from '@lawha/core/stories'
import { SceneGraph } from '@lawha/scene-graph'
import {
  addStory,
  createEpic,
  createUserStory,
  readEpics,
  readNodeStories,
  updateStory,
  upsertEpic
} from '@lawha/scene-graph/stories'

const SITE = 'https://lawha-test.atlassian.net'

function screen() {
  const graph = new SceneGraph()
  const [page] = graph.getPages()
  const frame = graph.createNode('FRAME', page.id, { name: 'Checkout' })
  const button = graph.createNode('FRAME', frame.id, { name: 'Pay' })
  const epic = upsertEpic(
    graph,
    createEpic({ title: 'Payments', description: 'Paying for orders' })
  )
  const story = addStory(
    graph,
    button.id,
    createUserStory({
      epicId: epic.id,
      title: 'Pay for the order',
      narrative: { role: 'shopper', goal: 'to pay', benefit: 'my order ships' },
      acceptanceCriteria: [
        { given: 'a full cart', when: 'I press Pay', outcome: 'I see a receipt' }
      ],
      behaviour: 'Submits the payment form.',
      states: ['default', 'loading']
    })
  )
  return { graph, frame, button, epic, story }
}

function connect(types = COMPANY_MANAGED_TYPES) {
  const jira = fakeJira({ projectKey: 'SHOP', issueTypes: types })
  const client = new JiraClient(
    basicAuthJiraTransport({
      site: SITE,
      email: 'sara@example.com',
      apiToken: 'token',
      fetch: jira.fetch
    })
  )
  return { jira, client }
}

describe('issue types', () => {
  test('company-managed projects use their Epic and Story types', () => {
    expect(pickStoryIssueTypes(COMPANY_MANAGED_TYPES)).toMatchObject({
      epic: { id: '10000' },
      story: { id: '10001' }
    })
  })

  test('team-managed projects are read by hierarchy level, whatever the types are called', () => {
    expect(pickStoryIssueTypes(TEAM_MANAGED_TYPES)).toMatchObject({
      epic: { id: '10121' },
      story: { id: '10120' }
    })
  })

  test('a project without an epic level has no epic type', () => {
    expect(
      pickStoryIssueTypes([{ id: '1', name: 'Task', subtask: false, hierarchyLevel: 0 }]).epic
    ).toBeNull()
  })
})

describe('push', () => {
  test('creates the Epic, then the Story under it through parent, and links both', async () => {
    const { graph, button, epic, story } = screen()
    const { jira, client } = connect()
    const result = await pushToJira(graph, client, { site: SITE, projectKey: 'SHOP' })
    applyJiraUpdates(graph, result.updates)

    const creates = jira.calls.filter(
      (call) => call.method === 'POST' && call.url.endsWith('/rest/api/3/issue')
    )
    expect(creates).toHaveLength(2)
    expect(creates[0].body).toMatchObject({
      fields: { project: { key: 'SHOP' }, issuetype: { id: '10000' }, summary: 'Payments' }
    })
    expect(creates[1].body).toMatchObject({
      fields: {
        issuetype: { id: '10001' },
        summary: 'Pay for the order',
        parent: { key: 'SHOP-1' }
      }
    })
    // Basic auth with the account's email and API token, as Atlassian documents it.
    expect(creates[0].authorization).toBe(`Basic ${encode('sara@example.com:token')}`)

    expect(readEpics(graph)[0]).toMatchObject({
      id: epic.id,
      jiraKey: 'SHOP-1',
      jiraUrl: `${SITE}/browse/SHOP-1`,
      jira: { status: 'To Do', category: 'new' }
    })
    expect(readNodeStories(graph.getNode(button.id))[0]).toMatchObject({
      id: story.id,
      jiraKey: 'SHOP-2',
      jiraUrl: `${SITE}/browse/SHOP-2`,
      jira: { status: 'To Do', category: 'new', assignee: null }
    })
    expect(result.items.map((item) => item.action)).toEqual(['created', 'created'])
  })

  test('the description is ADF with the statement, criteria, behaviour and states', () => {
    const { story } = screen()
    const doc = storyDescription(story, { path: ['Checkout', 'Pay'], pageName: 'Page 1' })
    expect(doc).toMatchObject({ type: 'doc', version: 1 })
    const texts = JSON.stringify(doc)
    expect(texts).toContain('As a shopper, I want to pay, so that my order ships.')
    expect(texts).toContain('Given a full cart, when I press Pay, then I see a receipt')
    expect(texts).toContain('orderedList')
    expect(texts).toContain('Submits the payment form.')
    expect(texts).toContain('loading')
    // ADF rejects empty text nodes.
    expect(texts).not.toContain('"text":""')
  })

  test('team-managed projects get their own type ids', async () => {
    const { graph } = screen()
    const { jira, client } = connect(TEAM_MANAGED_TYPES)
    await pushToJira(graph, client, { site: SITE, projectKey: 'SHOP' })
    const types = jira.calls
      .filter((call) => call.method === 'POST' && call.url.endsWith('/rest/api/3/issue'))
      .map((call) => call.body)
    expect(types).toMatchObject([
      { fields: { issuetype: { id: '10121' } } },
      { fields: { issuetype: { id: '10120' } } }
    ])
  })

  test('pushing again updates the linked issues instead of creating new ones', async () => {
    const { graph, button, story } = screen()
    const { jira, client } = connect()
    applyJiraUpdates(
      graph,
      (await pushToJira(graph, client, { site: SITE, projectKey: 'SHOP' })).updates
    )
    jira.calls.length = 0
    updateStory(graph, button.id, story.id, { title: 'Pay now' })
    const result = await pushToJira(graph, client, {
      site: SITE,
      projectKey: 'SHOP',
      storyIds: [story.id]
    })
    expect(result.items).toMatchObject([
      { kind: 'epic', action: 'updated' },
      { kind: 'story', action: 'updated', key: 'SHOP-2' }
    ])
    expect(jira.calls.some((call) => call.method === 'POST' && call.url.endsWith('/issue'))).toBe(
      false
    )
    expect(jira.issues.get('SHOP-2')?.fields.summary).toBe('Pay now')
  })

  test("a refused issue reports Jira's message and leaves the story unlinked", async () => {
    const { graph, button } = screen()
    const { client } = connect()
    addStory(graph, button.id, createUserStory({ title: '   ' }))
    // An empty summary falls back to the statement or a placeholder, so Jira accepts it.
    const result = await pushToJira(graph, client, { site: SITE, projectKey: 'SHOP' })
    expect(result.items.every((item) => item.action === 'created')).toBe(true)

    const failing = new JiraClient(async () => ({
      status: 403,
      body: { errorMessages: ['You do not have permission to create issues in this project.'] }
    }))
    const refused = await pushToJira(screen().graph, failing, {
      site: SITE,
      projectKey: 'SHOP'
    }).catch((error: unknown) => error)
    expect(refused).toBeInstanceOf(JiraError)
    expect(refused instanceof JiraError && refused.messages[0]).toContain('permission')
  })
})

describe('pull', () => {
  test('reads status and assignee back onto the linked stories and epics', async () => {
    const { graph, button } = screen()
    const { jira, client } = connect()
    applyJiraUpdates(
      graph,
      (await pushToJira(graph, client, { site: SITE, projectKey: 'SHOP' })).updates
    )
    const issue = jira.issues.get('SHOP-2')
    if (!issue) throw new Error('missing issue')
    issue.status = { name: 'In Progress', category: 'indeterminate' }
    issue.assignee = 'Omar'
    const result = await pullFromJira(graph, client, {
      now: () => new Date('2026-11-11T12:00:00Z')
    })
    applyJiraUpdates(graph, result.updates)
    expect(readNodeStories(graph.getNode(button.id))[0].jira).toEqual({
      status: 'In Progress',
      category: 'indeterminate',
      assignee: 'Omar',
      updated: '2026-11-11T10:00:00.000+0000',
      syncedAt: '2026-11-11T12:00:00.000Z'
    })
  })

  test('an issue Jira no longer returns is reported and keeps its link', async () => {
    const { graph, button } = screen()
    const { jira, client } = connect()
    applyJiraUpdates(
      graph,
      (await pushToJira(graph, client, { site: SITE, projectKey: 'SHOP' })).updates
    )
    jira.issues.delete('SHOP-2')
    const result = await pullFromJira(graph, client)
    expect(result.items.find((item) => item.key === 'SHOP-2')?.action).toBe('failed')
    expect(readNodeStories(graph.getNode(button.id))[0].jiraKey).toBe('SHOP-2')
  })

  test('nothing linked asks Jira nothing', async () => {
    const { graph } = screen()
    const { jira, client } = connect()
    expect(await pullFromJira(graph, client)).toEqual({ updates: [], items: [] })
    expect(jira.calls).toEqual([])
  })
})

describe('transport', () => {
  test('only the REST paths the stories use are sent', async () => {
    expect(isJiraAPIPath('/rest/api/3/issue/SHOP-2')).toBe(true)
    expect(isJiraAPIPath('/rest/api/3/search/jql')).toBe(true)
    expect(isJiraAPIPath('/rest/api/3/user/bulk')).toBe(false)
    expect(isJiraAPIPath('/rest/api/3/issue/SHOP-2/../../admin')).toBe(false)
    const { client } = connect()
    await expect(
      client.transport({ method: 'GET', path: '/rest/api/2/serverInfo' })
    ).rejects.toThrow()
  })

  test('a site address must be https', () => {
    expect(() =>
      basicAuthJiraTransport({ site: 'http://x.atlassian.net', email: 'a', apiToken: 'b', fetch })
    ).toThrow(JiraError)
  })
})
