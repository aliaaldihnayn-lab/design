import { uniq } from 'es-toolkit'

import type { SceneGraph } from '@lawha/scene-graph'
import {
  isPluginDataEntry,
  LAWHA_PLUGIN_DATA,
  LAWHA_PLUGIN_ID,
  type PluginDataKey
} from '@lawha/scene-graph/plugin-data'
import {
  addStory,
  createEpic,
  createUserStory,
  removeEpic,
  removeStory,
  updateEpic,
  updateStory,
  upsertEpic,
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

/**
 * User stories and epics as undoable editor commands. Each command records only the layers whose
 * stories it changed, so undo leaves every other plugin-data entry, and other edits made since,
 * as they are.
 */
export function createStoryActions(ctx: EditorContext) {
  /** Runs `change` on the graph as one undo step labelled `label`, and returns its result. */
  function editStories<T>(label: string, change: (graph: SceneGraph) => T): T {
    const before = snapshot(ctx.graph)
    const result = change(ctx.graph)
    const after = snapshot(ctx.graph)
    const touched = uniq([...before.keys(), ...after.keys()]).filter(
      (id) => (before.get(id) ?? []).join('\u0000') !== (after.get(id) ?? []).join('\u0000')
    )
    if (touched.length === 0) return result
    const apply = (state: StorySnapshot) => {
      for (const id of touched) restore(ctx.graph, id, state.get(id))
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
    setStoryJiraProject: (project: StoryJiraProject | undefined): void =>
      editStories('Choose Jira project', (graph) => writeStoryJiraProject(graph, project))
  }
}
