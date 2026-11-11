import { uniq } from 'es-toolkit'

import type { SceneGraph } from '@lawha/scene-graph'
import {
  JIRA_STATUS_CATEGORIES,
  readEpics,
  storyStatement,
  updateEpic,
  updateStory,
  type Epic,
  type JiraIssueState,
  type UserStory
} from '@lawha/scene-graph/stories'

import { storyReport, type ReportedStory } from '#core/stories/report'

import { epicDescription, storyDescription } from './adf'
import { jiraIssueURL, pickStoryIssueTypes, type JiraClient, type JiraIssue } from './client'

/** A change a sync makes to the document: an epic's or a story's Jira link and state. */
export type JiraLinkUpdate =
  | { kind: 'epic'; epicId: string; patch: Partial<Omit<Epic, 'id'>> }
  | { kind: 'story'; nodeId: string; storyId: string; patch: Partial<Omit<UserStory, 'id'>> }

/** What happened to one epic or story. */
export interface JiraSyncItem {
  kind: 'epic' | 'story'
  id: string
  nodeId?: string
  title: string
  key?: string
  action: 'created' | 'updated' | 'pulled' | 'failed'
  error?: string
}

export interface JiraSyncResult {
  updates: JiraLinkUpdate[]
  items: JiraSyncItem[]
}

export interface JiraScope {
  /** Layers whose stories (and the epics they use) to sync; the whole document when absent. */
  rootIds?: readonly string[]
  /** Only these stories, wherever they are under the roots. */
  storyIds?: readonly string[]
  /** The time recorded as `syncedAt`, for tests; now by default. */
  now?: () => Date
}

export interface JiraPushOptions extends JiraScope {
  site: string
  projectKey: string
}

/** Jira caps a summary at 255 characters. */
const SUMMARY_LIMIT = 255

function summary(title: string, fallback: string): string {
  const text = (title.trim() || fallback).replace(/\s+/g, ' ')
  return text.length > SUMMARY_LIMIT ? `${text.slice(0, SUMMARY_LIMIT - 1)}…` : text
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

interface Scope {
  stories: ReportedStory[]
  epics: Epic[]
}

function scope(graph: SceneGraph, options: JiraScope): Scope {
  const groups = storyReport(graph, options.rootIds)
  const wanted = options.storyIds && new Set(options.storyIds)
  const stories = groups
    .flatMap((group) => group.stories)
    .filter(({ story }) => !wanted || wanted.has(story.id))
  const used = new Set(stories.flatMap(({ story }) => (story.epicId ? [story.epicId] : [])))
  // A whole-document push creates epics that have no stories yet too.
  const whole = !options.rootIds && !options.storyIds
  const epics = groups.flatMap((group) =>
    group.epic && (whole || used.has(group.epic.id)) ? [group.epic] : []
  )
  return { stories, epics }
}

function issueState(issue: JiraIssue, syncedAt: string): JiraIssueState {
  const category = issue.fields.status?.statusCategory?.key
  return {
    status: issue.fields.status?.name ?? '',
    category: JIRA_STATUS_CATEGORIES.find((known) => known === category) ?? 'undefined',
    assignee: issue.fields.assignee?.displayName ?? null,
    updated: issue.fields.updated,
    syncedAt
  }
}

/**
 * Reads the status and assignee of every linked epic and story in scope from Jira. An issue
 * Jira no longer returns, deleted or moved out of reach, is reported and keeps its link.
 */
export async function pullFromJira(
  graph: SceneGraph,
  client: JiraClient,
  options: JiraScope = {}
): Promise<JiraSyncResult> {
  const { stories, epics } = scope(graph, options)
  const keys = uniq([
    ...epics.flatMap((epic) => (epic.jiraKey ? [epic.jiraKey] : [])),
    ...stories.flatMap(({ story }) => (story.jiraKey ? [story.jiraKey] : []))
  ])
  if (keys.length === 0) return { updates: [], items: [] }
  const syncedAt = (options.now?.() ?? new Date()).toISOString()
  const found = new Map((await client.issues(keys)).map((issue) => [issue.key, issue]))
  const result: JiraSyncResult = { updates: [], items: [] }
  for (const epic of epics) {
    if (!epic.jiraKey) continue
    const issue = found.get(epic.jiraKey)
    const item = { kind: 'epic' as const, id: epic.id, title: epic.title, key: epic.jiraKey }
    if (!issue) {
      result.items.push({ ...item, action: 'failed', error: 'Jira did not return this issue' })
      continue
    }
    result.updates.push({
      kind: 'epic',
      epicId: epic.id,
      patch: { jira: issueState(issue, syncedAt) }
    })
    result.items.push({ ...item, action: 'pulled' })
  }
  for (const { nodeId, story } of stories) {
    if (!story.jiraKey) continue
    const issue = found.get(story.jiraKey)
    const item = {
      kind: 'story' as const,
      id: story.id,
      nodeId,
      title: story.title,
      key: story.jiraKey
    }
    if (!issue) {
      result.items.push({ ...item, action: 'failed', error: 'Jira did not return this issue' })
      continue
    }
    result.updates.push({
      kind: 'story',
      nodeId,
      storyId: story.id,
      patch: { jira: issueState(issue, syncedAt) }
    })
    result.items.push({ ...item, action: 'pulled' })
  }
  return result
}

interface PushContext {
  client: JiraClient
  options: JiraPushOptions
  types: ReturnType<typeof pickStoryIssueTypes>
  result: JiraSyncResult
  /** Each epic's issue key, as the stories' parent. */
  epicKeys: Map<string, string>
}

function linkPatch(site: string, key: string) {
  return { jiraKey: key, jiraUrl: jiraIssueURL(site, key) }
}

async function pushEpic(context: PushContext, epic: Epic): Promise<void> {
  const { client, options, types, result, epicKeys } = context
  const item = { kind: 'epic' as const, id: epic.id, title: epic.title }
  const fields = {
    summary: summary(epic.title, 'Untitled epic'),
    description: epicDescription(epic)
  }
  try {
    if (epic.jiraKey) {
      await client.updateIssue(epic.jiraKey, fields)
      epicKeys.set(epic.id, epic.jiraKey)
      result.items.push({ ...item, key: epic.jiraKey, action: 'updated' })
      return
    }
    if (!types.epic) throw new Error(`Project ${options.projectKey} has no Epic issue type`)
    const created = await client.createIssue({
      ...fields,
      project: { key: options.projectKey },
      issuetype: { id: types.epic.id }
    })
    epicKeys.set(epic.id, created.key)
    result.updates.push({
      kind: 'epic',
      epicId: epic.id,
      patch: linkPatch(options.site, created.key)
    })
    result.items.push({ ...item, key: created.key, action: 'created' })
  } catch (error) {
    result.items.push({ ...item, action: 'failed', error: errorText(error) })
  }
}

async function pushStory(context: PushContext, placed: ReportedStory): Promise<void> {
  const { client, options, types, result, epicKeys } = context
  const { nodeId, story, path, pageName } = placed
  const item = { kind: 'story' as const, id: story.id, nodeId, title: story.title }
  const parentKey = story.epicId ? epicKeys.get(story.epicId) : undefined
  const fields: Record<string, unknown> = {
    summary: summary(story.title, storyStatement(story.narrative) || 'Untitled story'),
    description: storyDescription(story, { path, pageName }),
    ...(parentKey ? { parent: { key: parentKey } } : {})
  }
  try {
    if (story.jiraKey) {
      await client.updateIssue(story.jiraKey, fields)
      result.items.push({ ...item, key: story.jiraKey, action: 'updated' })
      return
    }
    if (!types.story) throw new Error(`Project ${options.projectKey} has no Story issue type`)
    const created = await client.createIssue({
      ...fields,
      project: { key: options.projectKey },
      issuetype: { id: types.story.id }
    })
    result.updates.push({
      kind: 'story',
      nodeId,
      storyId: story.id,
      patch: linkPatch(options.site, created.key)
    })
    result.items.push({ ...item, key: created.key, action: 'created' })
  } catch (error) {
    result.items.push({ ...item, action: 'failed', error: errorText(error) })
  }
}

/** Reads back the status of every issue the push wrote, as updates after its links. */
async function readBackStatus(context: PushContext): Promise<void> {
  const { client, options, result } = context
  const keys = uniq(result.items.flatMap((entry) => (entry.key ? [entry.key] : [])))
  if (keys.length === 0) return
  const syncedAt = (options.now?.() ?? new Date()).toISOString()
  let found: Map<string, JiraIssue>
  try {
    found = new Map((await client.issues(keys)).map((issue) => [issue.key, issue]))
  } catch (error) {
    // The issues were written; their status is read on the next pull.
    console.warn('[Jira] Could not read back issue status:', error)
    return
  }
  for (const entry of result.items) {
    const issue = entry.key ? found.get(entry.key) : undefined
    if (!issue) continue
    const jira = issueState(issue, syncedAt)
    if (entry.kind === 'epic')
      result.updates.push({ kind: 'epic', epicId: entry.id, patch: { jira } })
    else if (entry.nodeId) {
      result.updates.push({
        kind: 'story',
        nodeId: entry.nodeId,
        storyId: entry.id,
        patch: { jira }
      })
    }
  }
}

/**
 * Creates a Jira Epic for each epic in scope that has no issue yet and a Story for each story,
 * linked to its epic's issue through `parent`, which company-managed and team-managed projects
 * both take; issues that already exist get the current summary and description. Then reads
 * their status back. Nothing is written to the document: apply the returned updates.
 */
export async function pushToJira(
  graph: SceneGraph,
  client: JiraClient,
  options: JiraPushOptions
): Promise<JiraSyncResult> {
  const { stories, epics } = scope(graph, options)
  const result: JiraSyncResult = { updates: [], items: [] }
  if (stories.length === 0 && epics.length === 0) return result
  const context: PushContext = {
    client,
    options,
    types: pickStoryIssueTypes(await client.issueTypes(options.projectKey)),
    result,
    epicKeys: new Map()
  }
  for (const epic of epics) await pushEpic(context, epic)
  // Epics outside the scope that already have an issue still parent the stories in it.
  for (const epic of readEpics(graph)) {
    if (epic.jiraKey && !context.epicKeys.has(epic.id)) context.epicKeys.set(epic.id, epic.jiraKey)
  }
  for (const story of stories) await pushStory(context, story)
  await readBackStatus(context)
  return result
}

/** Writes a sync's updates into the document; later updates to the same item win. */
export function applyJiraUpdates(graph: SceneGraph, updates: readonly JiraLinkUpdate[]): void {
  for (const update of updates) {
    if (update.kind === 'epic') updateEpic(graph, update.epicId, update.patch)
    else updateStory(graph, update.nodeId, update.storyId, update.patch)
  }
}
