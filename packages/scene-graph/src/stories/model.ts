import type * as v from 'valibot'

import type { SceneGraph } from '../graph'
import { readPluginData, withPluginData } from '../plugin-data/field'
import { LAWHA_PLUGIN_DATA } from '../plugin-data/fields'
import { randomHex } from '../random'
import type { SceneNode } from '../types'
import type {
  acceptanceCriterionSchema,
  epicSchema,
  jiraIssueStateSchema,
  storyJiraProjectSchema,
  storyNarrativeSchema,
  userStorySchema,
  STORY_PRIORITIES,
  STORY_STATUSES
} from './schema'

export type Epic = v.InferOutput<typeof epicSchema>
export type UserStory = v.InferOutput<typeof userStorySchema>
export type AcceptanceCriterion = v.InferOutput<typeof acceptanceCriterionSchema>
export type StoryNarrative = v.InferOutput<typeof storyNarrativeSchema>
export type JiraIssueState = v.InferOutput<typeof jiraIssueStateSchema>
export type StoryJiraProject = v.InferOutput<typeof storyJiraProjectSchema>
export type StoryPriority = (typeof STORY_PRIORITIES)[number]
export type StoryStatus = (typeof STORY_STATUSES)[number]

/** A story with the layer it describes. */
export interface PlacedStory {
  nodeId: string
  story: UserStory
}

const { epics: epicsField, userStories: storiesField, storyJiraProject } = LAWHA_PLUGIN_DATA

/** A new id for an epic, story or criterion; unique enough that copies of layers never clash. */
export function createStoryId(): string {
  return randomHex(8)
}

export type EpicInput = Partial<Omit<Epic, 'id'>> & { id?: string }

export function createEpic(input: EpicInput = {}): Epic {
  return {
    id: input.id ?? createStoryId(),
    title: input.title ?? '',
    description: input.description ?? '',
    jiraKey: input.jiraKey,
    jiraUrl: input.jiraUrl,
    jira: input.jira
  }
}

export type AcceptanceCriterionInput = Partial<AcceptanceCriterion>

export function createAcceptanceCriterion(
  input: AcceptanceCriterionInput = {}
): AcceptanceCriterion {
  return {
    id: input.id ?? createStoryId(),
    given: input.given ?? '',
    when: input.when ?? '',
    outcome: input.outcome ?? ''
  }
}

export type UserStoryInput = Partial<Omit<UserStory, 'id' | 'narrative' | 'acceptanceCriteria'>> & {
  id?: string
  narrative?: Partial<StoryNarrative>
  acceptanceCriteria?: AcceptanceCriterionInput[]
}

export function createUserStory(input: UserStoryInput = {}): UserStory {
  return {
    id: input.id ?? createStoryId(),
    epicId: input.epicId ?? null,
    title: input.title ?? '',
    narrative: {
      role: input.narrative?.role ?? '',
      goal: input.narrative?.goal ?? '',
      benefit: input.narrative?.benefit ?? ''
    },
    acceptanceCriteria: (input.acceptanceCriteria ?? []).map(createAcceptanceCriterion),
    behaviour: input.behaviour ?? '',
    states: [...(input.states ?? [])],
    priority: input.priority ?? 'medium',
    status: input.status ?? 'draft',
    jiraKey: input.jiraKey,
    jiraUrl: input.jiraUrl,
    jira: input.jira
  }
}

function documentNode(graph: SceneGraph): SceneNode | undefined {
  return graph.getNode(graph.rootId)
}

/** The document's epics, in the order it lists them. */
export function readEpics(graph: SceneGraph): Epic[] {
  return readPluginData(documentNode(graph)?.pluginData, epicsField) ?? []
}

/** Stores the epics on the document node; an empty list removes the entry. */
export function writeEpics(graph: SceneGraph, epics: readonly Epic[]): void {
  const root = documentNode(graph)
  if (!root) return
  graph.updateNode(root.id, {
    pluginData: withPluginData(
      root.pluginData,
      epicsField,
      epics.length > 0 ? structuredClone([...epics]) : undefined
    )
  })
}

export function findEpic(graph: SceneGraph, epicId: string): Epic | undefined {
  return readEpics(graph).find((epic) => epic.id === epicId)
}

/** Adds an epic, or replaces the one with its id. */
export function upsertEpic(graph: SceneGraph, epic: Epic): Epic {
  const epics = readEpics(graph)
  const index = epics.findIndex((current) => current.id === epic.id)
  if (index === -1) epics.push(epic)
  else epics[index] = epic
  writeEpics(graph, epics)
  return epic
}

/** Changes an epic's fields; undefined when there is no such epic. */
export function updateEpic(
  graph: SceneGraph,
  epicId: string,
  patch: Partial<Omit<Epic, 'id'>>
): Epic | undefined {
  const epic = findEpic(graph, epicId)
  if (!epic) return undefined
  return upsertEpic(graph, { ...epic, ...patch, id: epic.id })
}

/** Removes an epic; its stories stay, without an epic. */
export function removeEpic(graph: SceneGraph, epicId: string): boolean {
  const epics = readEpics(graph)
  const remaining = epics.filter((epic) => epic.id !== epicId)
  if (remaining.length === epics.length) return false
  for (const { nodeId, story } of collectStories(graph)) {
    if (story.epicId === epicId) updateStory(graph, nodeId, story.id, { epicId: null })
  }
  writeEpics(graph, remaining)
  return true
}

/** A layer's stories, in the order it lists them. */
export function readNodeStories(node: Pick<SceneNode, 'pluginData'> | undefined): UserStory[] {
  return readPluginData(node?.pluginData, storiesField) ?? []
}

/** Replaces a layer's stories; an empty list removes the entry. */
export function writeNodeStories(
  graph: SceneGraph,
  nodeId: string,
  stories: readonly UserStory[]
): void {
  const node = graph.getNode(nodeId)
  if (!node) return
  graph.updateNode(nodeId, {
    pluginData: withPluginData(
      node.pluginData,
      storiesField,
      stories.length > 0 ? structuredClone([...stories]) : undefined
    )
  })
}

export function hasStories(node: Pick<SceneNode, 'pluginData'>): boolean {
  return readNodeStories(node).length > 0
}

/** Adds a story to a layer, last unless `index` says where. */
export function addStory(
  graph: SceneGraph,
  nodeId: string,
  story: UserStory,
  index?: number
): UserStory {
  const stories = readNodeStories(graph.getNode(nodeId))
  stories.splice(index ?? stories.length, 0, story)
  writeNodeStories(graph, nodeId, stories)
  return story
}

/** Changes a story's fields; undefined when the layer has no such story. */
export function updateStory(
  graph: SceneGraph,
  nodeId: string,
  storyId: string,
  patch: Partial<Omit<UserStory, 'id'>>
): UserStory | undefined {
  const stories = readNodeStories(graph.getNode(nodeId))
  const index = stories.findIndex((story) => story.id === storyId)
  if (index === -1) return undefined
  const updated = { ...stories[index], ...structuredClone(patch), id: storyId }
  stories[index] = updated
  writeNodeStories(graph, nodeId, stories)
  return updated
}

export function removeStory(graph: SceneGraph, nodeId: string, storyId: string): boolean {
  const stories = readNodeStories(graph.getNode(nodeId))
  const remaining = stories.filter((story) => story.id !== storyId)
  if (remaining.length === stories.length) return false
  writeNodeStories(graph, nodeId, remaining)
  return true
}

/**
 * Every story on `rootId` and the layers inside it, in layer order (a layer before its
 * children); the whole document when no root is given.
 */
export function collectStories(graph: SceneGraph, rootId: string = graph.rootId): PlacedStory[] {
  const placed: PlacedStory[] = []
  const visit = (id: string) => {
    const node = graph.getNode(id)
    if (!node) return
    for (const story of readNodeStories(node)) placed.push({ nodeId: id, story })
    for (const childId of node.childIds) visit(childId)
  }
  visit(rootId)
  return placed
}

/** Finds a story by id anywhere under `rootId`. */
export function findStory(
  graph: SceneGraph,
  storyId: string,
  rootId?: string
): PlacedStory | undefined {
  return collectStories(graph, rootId).find(({ story }) => story.id === storyId)
}

/** The Jira project the document's stories go to, when one was chosen. */
export function readStoryJiraProject(graph: SceneGraph): StoryJiraProject | undefined {
  return readPluginData(documentNode(graph)?.pluginData, storyJiraProject)
}

export function writeStoryJiraProject(
  graph: SceneGraph,
  project: StoryJiraProject | undefined
): void {
  const root = documentNode(graph)
  if (!root) return
  graph.updateNode(root.id, {
    pluginData: withPluginData(root.pluginData, storyJiraProject, project && { ...project })
  })
}

/** "As a role, I want goal, so that benefit", leaving out the parts not written yet. */
export function storyStatement(narrative: StoryNarrative): string {
  const parts: string[] = []
  if (narrative.role) parts.push(`As a ${narrative.role}`)
  if (narrative.goal) parts.push(`I want ${narrative.goal}`)
  if (narrative.benefit) parts.push(`so that ${narrative.benefit}`)
  return parts.length > 0 ? `${parts.join(', ')}.` : ''
}
