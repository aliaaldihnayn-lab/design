import type { SceneGraph } from '@lawha/scene-graph'
import {
  collectStories,
  readEpics,
  type Epic,
  type PlacedStory,
  type UserStory
} from '@lawha/scene-graph/stories'

/** A story with where it sits: its layer, the layers above it, and its page. */
export interface ReportedStory extends PlacedStory {
  /** Layer names from the top-level frame down to the story's layer. */
  path: string[]
  pageId: string | null
  pageName: string
}

/** One epic and its stories; `epic` is null for the stories that have none. */
export interface StoryGroup {
  epic: Epic | null
  stories: ReportedStory[]
}

/** Layer names from below the page down to `nodeId`. */
export function layerPath(graph: SceneGraph, nodeId: string): string[] {
  const names: string[] = []
  graph.closest(nodeId, (node) => {
    if (node.type === 'CANVAS' || node.id === graph.rootId) return true
    names.push(node.name)
    return false
  })
  return names.reverse()
}

/**
 * The stories on `rootIds` and everything inside them, in layer order, grouped by epic in the
 * document's epic order, stories without an epic last. With no roots, the whole document.
 */
export function storyReport(graph: SceneGraph, rootIds?: readonly string[]): StoryGroup[] {
  const roots = rootIds && rootIds.length > 0 ? rootIds : [graph.rootId]
  const seen = new Set<string>()
  const stories: ReportedStory[] = []
  for (const rootId of roots) {
    for (const placed of collectStories(graph, rootId)) {
      const key = `${placed.nodeId}:${placed.story.id}`
      if (seen.has(key)) continue
      seen.add(key)
      const pageId = graph.pageOf(placed.nodeId)
      stories.push({
        ...placed,
        path: layerPath(graph, placed.nodeId),
        pageId,
        pageName: (pageId && graph.getNode(pageId)?.name) || ''
      })
    }
  }
  const epics = readEpics(graph)
  const known = new Set(epics.map((epic) => epic.id))
  const groups: StoryGroup[] = epics.map((epic) => ({
    epic,
    stories: stories.filter(({ story }) => story.epicId === epic.id)
  }))
  const loose = stories.filter(({ story }) => !story.epicId || !known.has(story.epicId))
  if (loose.length > 0) groups.push({ epic: null, stories: loose })
  return groups
}

/** Groups that have stories, plus epics without any when `keepEmptyEpics` is set. */
export function nonEmptyGroups(groups: StoryGroup[], keepEmptyEpics = false): StoryGroup[] {
  return groups.filter((group) => group.stories.length > 0 || (keepEmptyEpics && group.epic))
}

/** How complete a story is, for the panel and agents: what is still missing. */
export function storyGaps(
  story: UserStory
): Array<'title' | 'narrative' | 'criteria' | 'behaviour'> {
  const gaps: Array<'title' | 'narrative' | 'criteria' | 'behaviour'> = []
  if (!story.title.trim()) gaps.push('title')
  const { role, goal, benefit } = story.narrative
  if (!role.trim() || !goal.trim() || !benefit.trim()) gaps.push('narrative')
  if (story.acceptanceCriteria.length === 0) gaps.push('criteria')
  if (!story.behaviour.trim()) gaps.push('behaviour')
  return gaps
}
