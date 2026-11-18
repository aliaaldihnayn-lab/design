import { afterEach, describe, expect, test } from 'bun:test'

import { COMPANY_MANAGED_TYPES, fakeJira } from '#core-tests/stories/jira/fake-jira'
import * as v from 'valibot'

import { FigmaAPI } from '@lawha/core/figma-api'
import { basicAuthJiraTransport, JiraClient, setJiraConnection } from '@lawha/core/stories'
import { SceneGraph } from '@lawha/scene-graph'
import { readEpics, readNodeStories, readStoryJiraProject } from '@lawha/scene-graph/stories'

import {
  addEpic,
  addUserStory,
  linkJiraIssue,
  listUserStories,
  syncJira
} from '#core/tools/stories'

const SITE = 'https://lawha-test.atlassian.net'

function screen() {
  const figma = new FigmaAPI(new SceneGraph())
  const frame = figma.createFrame()
  frame.name = 'Sign in'
  const button = figma.createFrame()
  button.name = 'Continue'
  frame.appendChild(button)
  return { figma, frame, button }
}

const storyIdSchema = v.object({ story: v.object({ id: v.string() }) })

afterEach(() => setJiraConnection(null))

describe('story tools', () => {
  test('agents add epics and stories, and list them grouped by epic with what is missing', async () => {
    const { figma, frame, button } = screen()
    const epic = await addEpic.execute(figma, { title: 'Authentication' })
    expect(epic).toMatchObject({ created: true, epic: { title: 'Authentication' } })
    expect(await addEpic.execute(figma, { title: 'authentication' })).toMatchObject({
      created: false
    })

    await addUserStory.execute(figma, {
      node: button.id,
      title: 'Continue to the app',
      epic: 'Authentication',
      asA: 'returning user',
      iWant: 'to continue',
      soThat: 'I reach my orders',
      acceptanceCriteria: [
        { given: 'valid details', when: 'I press Continue', outcome: 'the home screen opens' }
      ],
      behaviour: 'Disabled until both fields are valid.',
      states: ['default', 'disabled', 'loading'],
      priority: 'high'
    })
    await addUserStory.execute(figma, { node: frame.id, title: 'See sign in', epic: 'Onboarding' })

    expect(readEpics(figma.graph).map((item) => item.title)).toEqual([
      'Authentication',
      'Onboarding'
    ])
    const listed = await listUserStories.execute(figma, { node: frame.id })
    expect(listed).toMatchObject({
      epics: [
        {
          epic: { title: 'Authentication' },
          stories: [{ layer: button.id, title: 'Continue to the app', missing: [] }]
        },
        {
          epic: { title: 'Onboarding' },
          stories: [{ layer: frame.id, missing: ['narrative', 'criteria', 'behaviour'] }]
        }
      ]
    })
    expect(await addUserStory.execute(figma, { node: '9:9', title: 'x' })).toEqual({
      error: 'Node "9:9" not found'
    })
  })

  test('link_jira_issue links a story and an epic to existing issues', async () => {
    const { figma, button } = screen()
    const added = v.parse(
      storyIdSchema,
      await addUserStory.execute(figma, { node: button.id, title: 'Pay' })
    )
    await addEpic.execute(figma, { title: 'Checkout' })
    setJiraConnection({
      site: SITE,
      client: new JiraClient(async () => ({ status: 500, body: null }))
    })
    await linkJiraIssue.execute(figma, { key: 'SHOP-7', node: button.id, story: added.story.id })
    await linkJiraIssue.execute(figma, { key: 'SHOP-1', epic: 'checkout' })
    expect(readNodeStories(figma.graph.getNode(button.id))[0]).toMatchObject({
      jiraKey: 'SHOP-7',
      jiraUrl: `${SITE}/browse/SHOP-7`
    })
    expect(readEpics(figma.graph)[0].jiraKey).toBe('SHOP-1')
  })

  test('sync_jira pushes to the connected site, remembers the project, and reads status back', async () => {
    const { figma, button } = screen()
    await addUserStory.execute(figma, { node: button.id, title: 'Pay', epic: 'Checkout' })
    expect(await syncJira.execute(figma, { direction: 'push' })).toMatchObject({
      error: expect.stringContaining('No Jira site')
    })

    const jira = fakeJira({ projectKey: 'SHOP', issueTypes: COMPANY_MANAGED_TYPES })
    setJiraConnection({
      site: SITE,
      client: new JiraClient(
        basicAuthJiraTransport({ site: SITE, email: 'a@b.co', apiToken: 't', fetch: jira.fetch })
      )
    })
    expect(await syncJira.execute(figma, { direction: 'push' })).toMatchObject({
      error: expect.stringContaining('projectKey')
    })
    const result = await syncJira.execute(figma, { direction: 'both', projectKey: 'SHOP' })
    expect(result).toMatchObject({ push: { created: 2, failed: 0 }, pull: { failed: 0 } })
    expect(readStoryJiraProject(figma.graph)).toEqual({ site: SITE, projectKey: 'SHOP' })
    expect(readNodeStories(figma.graph.getNode(button.id))[0]).toMatchObject({
      jiraKey: 'SHOP-2',
      jira: { status: 'To Do' }
    })
    expect(jira.issues.get('SHOP-2')?.fields.parent).toEqual({ key: 'SHOP-1' })
  })
})
