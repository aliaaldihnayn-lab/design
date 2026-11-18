import type { SceneGraph, SceneNode } from '@lawha/scene-graph'
import { readEpics, readNodeStories, type UserStory } from '@lawha/scene-graph/stories'

import type { JSXProp, JSXValue } from './value'

/** A story as `stories={[…]}` reads it back, leaving out what a new story starts with. */
/** The story's epic by title; its description travels with it, so the epic found is the same. */
function epicValue(story: UserStory, graph: SceneGraph): JSXValue | undefined {
  const epic = story.epicId ? readEpics(graph).find((item) => item.id === story.epicId) : undefined
  if (!epic) return undefined
  return epic.description ? { title: epic.title, description: epic.description } : epic.title
}

function storyValue(story: UserStory, graph: SceneGraph): JSXValue {
  return {
    title: story.title,
    epic: epicValue(story, graph),
    asA: story.narrative.role || undefined,
    iWant: story.narrative.goal || undefined,
    soThat: story.narrative.benefit || undefined,
    criteria:
      story.acceptanceCriteria.length > 0
        ? story.acceptanceCriteria.map((criterion) => ({
            given: criterion.given,
            when: criterion.when,
            // eslint-disable-next-line unicorn/no-thenable -- `then` is the JSX's own key for the outcome, as `stories={[…]}` reads it; the object is never awaited.
            then: criterion.outcome
          }))
        : undefined,
    behaviour: story.behaviour || undefined,
    states: story.states.length > 0 ? [...story.states] : undefined,
    priority: story.priority === 'medium' ? undefined : story.priority,
    status: story.status === 'draft' ? undefined : story.status
  }
}

/**
 * The layer's user stories as `stories={[…]}`, with their epics by title, so exported JSX carries
 * the product spec and renders it back. Jira issues stay with the document's stories: what the
 * JSX makes is a copy, as a pasted layer is.
 */
export function collectStoryProps(node: SceneNode, graph: SceneGraph, props: JSXProp[]): void {
  const stories = readNodeStories(node)
  if (stories.length === 0) return
  props.push(['stories', stories.map((story) => storyValue(story, graph))])
}
