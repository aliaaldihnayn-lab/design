import * as v from 'valibot'

import type { SceneGraph, SceneNode } from '@lawha/scene-graph'
import {
  addStory,
  createEpic,
  createUserStory,
  readEpics,
  STORY_PRIORITIES,
  STORY_STATUSES,
  upsertEpic,
  type Epic
} from '@lawha/scene-graph/stories'

const textSchema = v.pipe(v.string(), v.maxLength(20_000))

const inlineEpicSchema = v.union([
  v.pipe(v.string(), v.nonEmpty()),
  v.object({
    title: v.pipe(v.string(), v.nonEmpty(), v.maxLength(500)),
    description: v.optional(textSchema)
  })
])

/** `{ given, when, then }`, or one sentence such as "Given …, when …, then …". */
const inlineCriterionSchema = v.union([v.string(), v.record(v.string(), v.string())])

const inlineStorySchema = v.object({
  title: v.pipe(v.string(), v.maxLength(500)),
  /** The epic's title; an epic of that title is found in the document or created. */
  epic: v.optional(inlineEpicSchema),
  asA: v.optional(v.string()),
  iWant: v.optional(v.string()),
  soThat: v.optional(v.string()),
  criteria: v.optional(v.array(inlineCriterionSchema)),
  behaviour: v.optional(textSchema),
  states: v.optional(v.array(v.string())),
  priority: v.optional(v.picklist(STORY_PRIORITIES)),
  status: v.optional(v.picklist(STORY_STATUSES))
})

const inlineStoriesSchema = v.array(inlineStorySchema)
const inlineEpicsSchema = v.array(inlineEpicSchema)

/** The JSX shape of one story, as `stories={[…]}` takes it. */
export type InlineStory = v.InferOutput<typeof inlineStorySchema>

function criterion(value: string | Record<string, string>) {
  if (typeof value !== 'string') {
    const parts = new Map(Object.entries(value))
    return {
      given: parts.get('given') ?? '',
      when: parts.get('when') ?? '',
      outcome: parts.get('then') ?? ''
    }
  }
  const match = /^\s*given\s+(.*?)(?:,?\s*when\s+(.*?))?(?:,?\s*then\s+(.*?))?\.?\s*$/is.exec(value)
  if (!match) return { given: value.trim(), when: '', outcome: '' }
  return { given: match.at(1) ?? '', when: match.at(2) ?? '', outcome: match.at(3) ?? '' }
}

/** The document's epic of this title, matched without regard to case, or a new one. */
function epicNamed(
  graph: SceneGraph,
  value: string | { title: string; description?: string }
): Epic {
  const title = typeof value === 'string' ? value.trim() : value.title.trim()
  const description = typeof value === 'string' ? undefined : value.description
  const existing = readEpics(graph).find(
    (epic) => epic.title.trim().toLowerCase() === title.toLowerCase()
  )
  if (existing) {
    if (description && !existing.description) {
      return upsertEpic(graph, { ...existing, description })
    }
    return existing
  }
  return upsertEpic(graph, createEpic({ title, description: description ?? '' }))
}

function invalid(prop: string, issues: [v.BaseIssue<unknown>, ...v.BaseIssue<unknown>[]]): Error {
  return new Error(`Invalid ${prop}: ${v.summarize(issues)}`)
}

/**
 * Adds the epics an element declares, `epics={[…]}`, to the document. It runs before the
 * element's children render, so their stories find the epics as written here.
 */
export function applyInlineEpics(
  graph: SceneGraph,
  props: Readonly<Record<string, unknown>>
): void {
  if (props.epics === undefined) return
  const parsed = v.safeParse(inlineEpicsSchema, props.epics)
  if (!parsed.success) throw invalid('epics', parsed.issues)
  for (const epic of parsed.output) epicNamed(graph, epic)
}

/**
 * Stores the user stories an element declares, `stories={[…]}`, on the layer it made, finding or
 * creating each story's epic by title, so a design arrives with its product spec.
 */
export function applyInlineStories(
  graph: SceneGraph,
  node: SceneNode,
  props: Readonly<Record<string, unknown>>
): void {
  if (props.stories === undefined) return
  const parsed = v.safeParse(inlineStoriesSchema, props.stories)
  if (!parsed.success) throw invalid('stories', parsed.issues)
  for (const story of parsed.output) {
    addStory(
      graph,
      node.id,
      createUserStory({
        title: story.title,
        epicId: story.epic ? epicNamed(graph, story.epic).id : null,
        narrative: { role: story.asA ?? '', goal: story.iWant ?? '', benefit: story.soThat ?? '' },
        acceptanceCriteria: (story.criteria ?? []).map(criterion),
        behaviour: story.behaviour ?? '',
        states: story.states ?? [],
        priority: story.priority,
        status: story.status
      })
    )
  }
}
