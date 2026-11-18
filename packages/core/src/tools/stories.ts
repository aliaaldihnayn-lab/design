import * as v from 'valibot'

import type { SceneGraph } from '@lawha/scene-graph'
import {
  addStory,
  createEpic,
  createUserStory,
  JIRA_ISSUE_KEY_PATTERN,
  readEpics,
  readStoryJiraProject,
  STORY_PRIORITIES,
  STORY_STATUSES,
  updateEpic,
  updateStory,
  upsertEpic,
  writeStoryJiraProject,
  type Epic
} from '@lawha/scene-graph/stories'

import {
  applyJiraUpdates,
  getJiraConnection,
  jiraIssueURL,
  pullFromJira,
  pushToJira,
  type JiraSyncResult
} from '#core/stories/jira'
import { storyGaps, storyReport } from '#core/stories/report'
import { defineTool, nodeNotFound, toolFailure } from '#core/tools/schema'

/** The epic named by id or title, matched without regard to case. */
function findEpic(graph: SceneGraph, idOrTitle: string): Epic | undefined {
  const wanted = idOrTitle.trim().toLowerCase()
  return readEpics(graph).find(
    (epic) => epic.id === idOrTitle || epic.title.trim().toLowerCase() === wanted
  )
}

const criterionSchema = v.object({
  given: v.pipe(v.string(), v.description('Given: the starting situation')),
  when: v.pipe(v.string(), v.description('When: what the person does')),
  outcome: v.pipe(v.string(), v.description('Then: what must happen'))
})

export const addEpic = defineTool({
  name: 'add_epic',
  description:
    'Add an epic, a feature such as Checkout or Onboarding that groups user stories, to the ' +
    'document. An epic with the same title is returned instead of a second one.',
  execution: { kind: 'sync', mutation: 'document' },
  input: v.strictObject({
    title: v.pipe(v.string(), v.minLength(1), v.description('Epic title')),
    description: v.optional(v.pipe(v.string(), v.description('What the feature is for'))),
    jiraKey: v.optional(
      v.pipe(
        v.string(),
        v.regex(JIRA_ISSUE_KEY_PATTERN),
        v.description('An existing Jira Epic, e.g. SHOP-1')
      )
    )
  }),
  execute: (figma, { title, description, jiraKey }) => {
    const existing = findEpic(figma.graph, title)
    if (existing) return { epic: existing, created: false }
    const site = getJiraConnection()?.site
    const epic = upsertEpic(
      figma.graph,
      createEpic({
        title,
        description: description ?? '',
        jiraKey,
        jiraUrl: jiraKey && site ? jiraIssueURL(site, jiraKey) : undefined
      })
    )
    return { epic, created: true }
  }
})

export const addUserStory = defineTool({
  name: 'add_user_story',
  description:
    'Attach a user story to a frame or any element (button, input, dropdown, tab, toggle, ' +
    'link…): what it is for ("As a … I want … so that …"), Given/When/Then acceptance criteria, ' +
    'its behaviour, and the states it covers. A layer can carry many stories. Name an epic by ' +
    'id or title; a title no epic has creates one.',
  execution: { kind: 'sync', mutation: 'document' },
  input: v.strictObject({
    node: v.pipe(v.string(), v.description('Layer ID of the frame or element')),
    title: v.pipe(v.string(), v.minLength(1), v.description('Short story title')),
    epic: v.optional(v.pipe(v.string(), v.description('Epic id or title'))),
    asA: v.optional(v.pipe(v.string(), v.description('As a … (the role)'))),
    iWant: v.optional(v.pipe(v.string(), v.description('I want … (the goal)'))),
    soThat: v.optional(v.pipe(v.string(), v.description('so that … (the benefit)'))),
    acceptanceCriteria: v.optional(v.array(criterionSchema)),
    behaviour: v.optional(
      v.pipe(v.string(), v.description('What the element does: rules, edge cases'))
    ),
    states: v.optional(
      v.pipe(
        v.array(v.string()),
        v.description('States covered, e.g. default, hover, disabled, error')
      )
    ),
    priority: v.optional(v.picklist(STORY_PRIORITIES)),
    status: v.optional(v.picklist(STORY_STATUSES))
  }),
  execute: (figma, args) => {
    const { graph } = figma
    if (!graph.getNode(args.node)) return nodeNotFound(args.node)
    let epicId: string | null = null
    if (args.epic) {
      epicId = (findEpic(graph, args.epic) ?? upsertEpic(graph, createEpic({ title: args.epic })))
        .id
    }
    const story = addStory(
      graph,
      args.node,
      createUserStory({
        title: args.title,
        epicId,
        narrative: { role: args.asA, goal: args.iWant, benefit: args.soThat },
        acceptanceCriteria: args.acceptanceCriteria,
        behaviour: args.behaviour,
        states: args.states,
        priority: args.priority,
        status: args.status
      })
    )
    return { node: args.node, story }
  }
})

export const listUserStories = defineTool({
  name: 'list_user_stories',
  description:
    'List the epics and user stories of a frame and everything in it, a page, or the whole ' +
    'document, grouped by epic, with each story’s layer, Jira link and status, and what each ' +
    'story still lacks (title, narrative, criteria, behaviour).',
  execution: { kind: 'sync', mutation: 'none' },
  input: v.strictObject({
    node: v.optional(
      v.pipe(v.string(), v.description('Frame, layer or page ID; the document if omitted'))
    ),
    epic: v.optional(v.pipe(v.string(), v.description('Only this epic, by id or title')))
  }),
  execute: (figma, { node, epic }) => {
    const { graph } = figma
    if (node && !graph.getNode(node)) return nodeNotFound(node)
    const wanted = epic ? findEpic(graph, epic) : undefined
    if (epic && !wanted) return { error: `No epic "${epic}"` }
    const groups = storyReport(graph, node ? [node] : undefined).filter(
      (group) => !wanted || group.epic?.id === wanted.id
    )
    return {
      jiraProject: readStoryJiraProject(graph) ?? null,
      epics: groups.map((group) => ({
        epic: group.epic,
        stories: group.stories.map(({ nodeId, path, story }) => ({
          layer: nodeId,
          layerPath: path.join(' / '),
          ...story,
          missing: storyGaps(story)
        }))
      }))
    }
  }
})

export const linkJiraIssue = defineTool({
  name: 'link_jira_issue',
  description:
    'Link a user story or an epic to an existing Jira issue by key, such as SHOP-12, without ' +
    'creating one. The issue URL comes from the connected Jira site unless given.',
  execution: { kind: 'sync', mutation: 'document' },
  input: v.strictObject({
    key: v.pipe(v.string(), v.regex(JIRA_ISSUE_KEY_PATTERN), v.description('Jira issue key')),
    url: v.optional(v.pipe(v.string(), v.url(), v.description('The issue’s address'))),
    node: v.optional(v.pipe(v.string(), v.description('Layer ID of the story, with story'))),
    story: v.optional(v.pipe(v.string(), v.description('Story id, with node'))),
    epic: v.optional(v.pipe(v.string(), v.description('Epic id or title, instead of a story')))
  }),
  execute: (figma, { key, url, node, story, epic }) => {
    const { graph } = figma
    const site = getJiraConnection()?.site ?? readStoryJiraProject(graph)?.site
    const issueURL = url ?? (site ? jiraIssueURL(site, key) : undefined)
    if (epic) {
      const found = findEpic(graph, epic)
      if (!found) return { error: `No epic "${epic}"` }
      return { epic: updateEpic(graph, found.id, { jiraKey: key, jiraUrl: issueURL }) }
    }
    if (!node || !story) return { error: 'Give node and story, or epic' }
    if (!graph.getNode(node)) return nodeNotFound(node)
    const updated = updateStory(graph, node, story, { jiraKey: key, jiraUrl: issueURL })
    return updated ? { story: updated } : { error: `Layer ${node} has no story "${story}"` }
  }
})

function syncReport(result: JiraSyncResult) {
  return {
    items: result.items,
    created: result.items.filter((item) => item.action === 'created').length,
    updated: result.items.filter((item) => item.action === 'updated').length,
    failed: result.items.filter((item) => item.action === 'failed').length
  }
}

export const syncJira = defineTool({
  name: 'sync_jira',
  description:
    'Sync user stories with the connected Jira Cloud site. push creates a Jira Epic for each ' +
    'epic and a Story under it for each story that has no issue yet, and updates the linked ' +
    'ones; pull reads status and assignee back; both does push then pull. Scope it to a frame ' +
    'or layer with node. Fails when no Jira site is connected: the person connects one in ' +
    'Settings → Jira in Lawha.',
  execution: { kind: 'async', mutation: 'document' },
  capabilities: ['document:write', 'network:access'],
  input: v.strictObject({
    direction: v.optional(v.picklist(['push', 'pull', 'both']), 'both'),
    node: v.optional(
      v.pipe(v.string(), v.description('Frame or layer ID; the document if omitted'))
    ),
    projectKey: v.optional(
      v.pipe(
        v.string(),
        v.regex(/^[A-Z][A-Z0-9_]*$/),
        v.description('Jira project key; remembered on the document')
      )
    )
  }),
  execute: async (figma, { direction, node, projectKey }) => {
    const connection = getJiraConnection()
    if (!connection) {
      return { error: 'No Jira site is connected. Ask the person to connect one first.' }
    }
    const { graph } = figma
    if (node && !graph.getNode(node)) return nodeNotFound(node)
    const scope = { rootIds: node ? [node] : undefined }
    const key =
      projectKey ?? readStoryJiraProject(graph)?.projectKey ?? connection.defaultProjectKey
    try {
      const report: Record<string, unknown> = {}
      if (direction !== 'pull') {
        if (!key) return { error: 'Give projectKey: no Jira project is chosen for this document' }
        if (projectKey) writeStoryJiraProject(graph, { site: connection.site, projectKey })
        const pushed = await pushToJira(graph, connection.client, {
          ...scope,
          site: connection.site,
          projectKey: key
        })
        applyJiraUpdates(graph, pushed.updates)
        report.push = syncReport(pushed)
      }
      if (direction !== 'push') {
        const pulled = await pullFromJira(graph, connection.client, scope)
        applyJiraUpdates(graph, pulled.updates)
        report.pull = syncReport(pulled)
      }
      return { site: connection.site, projectKey: key ?? null, ...report }
    } catch (error) {
      return toolFailure(error)
    }
  }
})
