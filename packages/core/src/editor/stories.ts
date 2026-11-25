import { isEqual, uniq } from 'es-toolkit'

import type { SceneGraph } from '@lawha/scene-graph'
import {
  isPluginDataEntry,
  LAWHA_PLUGIN_DATA,
  LAWHA_PLUGIN_ID,
  type PluginDataKey
} from '@lawha/scene-graph/plugin-data'
import {
  addStory,
  collectStories,
  copyMainComponentStories,
  createEpic,
  createUserStory,
  removeEpic,
  removeStory,
  updateEpic,
  readEpics,
  readNodeStories,
  updateStory,
  upsertEpic,
  writeEpics,
  writeNodeStories,
  writeStoryJiraProject,
  type Epic,
  type EpicInput,
  type StoryJiraProject,
  type UserStory,
  type UserStoryInput
} from '@lawha/scene-graph/stories'

import type { EditorContext } from './types'

/** The plugin-data keys a story edit can touch: epics and the project on the document node. */
const STORY_KEYS: readonly PluginDataKey[] = [
  LAWHA_PLUGIN_DATA.userStories,
  LAWHA_PLUGIN_DATA.epics,
  LAWHA_PLUGIN_DATA.storyJiraProject
]

/** Each layer's raw story entries, by layer id, for the layers that have any. */
type StorySnapshot = Map<string, string[]>

function snapshot(graph: SceneGraph): StorySnapshot {
  const entries: StorySnapshot = new Map()
  for (const node of graph.getAllNodes()) {
    const values = STORY_KEYS.map(
      (key) => node.pluginData.find((entry) => isPluginDataEntry(entry, key))?.value ?? ''
    )
    if (values.some((value) => value !== '')) entries.set(node.id, values)
  }
  return entries
}

function restore(graph: SceneGraph, nodeId: string, values: readonly string[] | undefined): void {
  const node = graph.getNode(nodeId)
  if (!node) return
  const others = node.pluginData.filter(
    (entry) => !STORY_KEYS.some((key) => isPluginDataEntry(entry, key))
  )
  const kept = STORY_KEYS.flatMap((key, index) => {
    const value = values?.[index]
    return value ? [{ pluginId: LAWHA_PLUGIN_ID, key: key.key, value }] : []
  })
  graph.updateNode(nodeId, { pluginData: [...others, ...kept] })
}

/** The Jira issue a story or epic is linked to, and what Jira last said about it. */
type JiraLink = Pick<UserStory, 'jiraKey' | 'jiraUrl' | 'jira'>

function linkOf(item: JiraLink | undefined): JiraLink {
  return { jiraKey: item?.jiraKey, jiraUrl: item?.jiraUrl, jira: item?.jira }
}

/** Every story's and epic's link, by `story:<id>` and `epic:<id>`. */
function graphLinks(graph: SceneGraph): Map<string, JiraLink> {
  const links = new Map<string, JiraLink>()
  for (const epic of readEpics(graph)) links.set(`epic:${epic.id}`, linkOf(epic))
  for (const { story } of collectStories(graph)) links.set(`story:${story.id}`, linkOf(story))
  return links
}

/** Gives the stories and epics on `nodeIds` the links `linkFor` names for them. */
function relink(
  graph: SceneGraph,
  nodeIds: readonly string[],
  linkFor: (key: string) => JiraLink | undefined
): void {
  const apply = <T extends JiraLink & { id: string }>(items: T[], kind: string) => {
    let changed = false
    const next = items.map((item) => {
      const link = linkFor(`${kind}:${item.id}`)
      if (!link || isEqual(linkOf(item), link)) return item
      changed = true
      return { ...item, ...link }
    })
    return changed ? next : null
  }
  for (const nodeId of nodeIds) {
    const stories = apply(readNodeStories(graph.getNode(nodeId)), 'story')
    if (stories) writeNodeStories(graph, nodeId, stories)
    if (nodeId !== graph.rootId) continue
    const epics = apply(readEpics(graph), 'epic')
    if (epics) writeEpics(graph, epics)
  }
}

/**
 * User stories and epics as undoable editor commands. Each command records only the layers whose
 * stories it changed, so undo leaves every other plugin-data entry, and other edits made since,
 * as they are.
 */
export function createStoryActions(ctx: EditorContext) {
  /** The last link seen on each story and epic, kept for when undo or redo brings one back. */
  const knownLinks = new Map<string, JiraLink>()

  /** Runs `change` on the graph as one undo step labelled `label`, and returns its result. */
  function editStories<T>(label: string, change: (graph: SceneGraph) => T): T {
    const before = snapshot(ctx.graph)
    const linksBefore = graphLinks(ctx.graph)
    const result = change(ctx.graph)
    const after = snapshot(ctx.graph)
    const linksAfter = graphLinks(ctx.graph)
    const touched = uniq([...before.keys(), ...after.keys()]).filter(
      (id) => (before.get(id) ?? []).join('\u0000') !== (after.get(id) ?? []).join('\u0000')
    )
    if (touched.length === 0) return result
    // Links a sync wrote since this step are not part of it: undo and redo keep them, so a story
    // never forgets the issue it already has in Jira and a later push never creates it twice.
    const ownLinks = new Set(
      uniq([...linksBefore.keys(), ...linksAfter.keys()]).filter(
        (key) => !isEqual(linkOf(linksBefore.get(key)), linkOf(linksAfter.get(key)))
      )
    )
    const apply = (state: StorySnapshot) => {
      for (const [key, link] of graphLinks(ctx.graph)) if (link.jiraKey) knownLinks.set(key, link)
      for (const id of touched) restore(ctx.graph, id, state.get(id))
      relink(ctx.graph, touched, (key) => (ownLinks.has(key) ? undefined : knownLinks.get(key)))
      ctx.requestRender()
    }
    ctx.requestRender()
    ctx.undo.push({ label, forward: () => apply(after), inverse: () => apply(before) })
    return result
  }

  return {
    editStories,
    addUserStory: (nodeId: string, input: UserStoryInput = {}, index?: number): UserStory =>
      editStories('Add user story', (graph) =>
        addStory(graph, nodeId, createUserStory(input), index)
      ),
    updateUserStory: (
      nodeId: string,
      storyId: string,
      patch: Partial<Omit<UserStory, 'id'>>
    ): UserStory | undefined =>
      editStories('Edit user story', (graph) => updateStory(graph, nodeId, storyId, patch)),
    removeUserStory: (nodeId: string, storyId: string): boolean =>
      editStories('Delete user story', (graph) => removeStory(graph, nodeId, storyId)),
    addEpic: (input: EpicInput = {}): Epic =>
      editStories('Add epic', (graph) => upsertEpic(graph, createEpic(input))),
    updateEpic: (epicId: string, patch: Partial<Omit<Epic, 'id'>>): Epic | undefined =>
      editStories('Edit epic', (graph) => updateEpic(graph, epicId, patch)),
    removeEpic: (epicId: string): boolean =>
      editStories('Delete epic', (graph) => removeEpic(graph, epicId)),
    /** Gives an instance its main component's stories as stories of its own, as one step. */
    copyMainComponentStories: (instanceId: string): number =>
      editStories('Copy main component stories', (graph) =>
        copyMainComponentStories(graph, instanceId)
      ),
    setStoryJiraProject: (project: StoryJiraProject | undefined): void =>
      editStories('Choose Jira project', (graph) => writeStoryJiraProject(graph, project))
  }
}
