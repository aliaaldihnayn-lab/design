import * as v from 'valibot'

/** Priorities, named as Jira's default priority scheme names them. */
export const STORY_PRIORITIES = ['highest', 'high', 'medium', 'low', 'lowest'] as const

/** Where a story is in its life, before or apart from any Jira workflow. */
export const STORY_STATUSES = ['draft', 'ready', 'in-progress', 'in-review', 'done'] as const

/** Jira's status categories (`statusCategory.key`), which every workflow's statuses map onto. */
export const JIRA_STATUS_CATEGORIES = ['new', 'indeterminate', 'done', 'undefined'] as const

/** An issue key such as `SHOP-12`: a project key, a dash and a number. */
export const JIRA_ISSUE_KEY_PATTERN = /^[A-Z][A-Z0-9_]{0,254}-[1-9]\d*$/

const idSchema = v.pipe(v.string(), v.nonEmpty(), v.maxLength(64))
const titleSchema = v.pipe(v.string(), v.maxLength(500))
const proseSchema = v.pipe(v.string(), v.maxLength(20_000))
const lineSchema = v.pipe(v.string(), v.maxLength(2000))

/** What Jira last said about a linked issue, so the canvas shows it without asking again. */
export const jiraIssueStateSchema = v.object({
  status: v.pipe(v.string(), v.maxLength(200)),
  category: v.fallback(v.picklist(JIRA_STATUS_CATEGORIES), 'undefined'),
  assignee: v.fallback(v.nullable(v.pipe(v.string(), v.maxLength(200))), null),
  /** The issue's own `updated` time, as Jira reported it. */
  updated: v.fallback(v.optional(v.string()), undefined),
  /** When Lawha last read the issue, an ISO timestamp. */
  syncedAt: v.string()
})

/** The Jira issue a story or epic is linked to. */
const jiraLinkFields = {
  jiraKey: v.fallback(v.optional(v.pipe(v.string(), v.regex(JIRA_ISSUE_KEY_PATTERN))), undefined),
  jiraUrl: v.fallback(v.optional(v.pipe(v.string(), v.url(), v.maxLength(2000))), undefined),
  jira: v.fallback(v.optional(jiraIssueStateSchema), undefined)
}

/** A group of stories, such as Checkout or Onboarding, which becomes a Jira Epic. */
export const epicSchema = v.object({
  id: idSchema,
  title: titleSchema,
  description: v.fallback(proseSchema, ''),
  ...jiraLinkFields
})

/** One Given/When/Then acceptance criterion. */
export const acceptanceCriterionSchema = v.object({
  id: idSchema,
  given: v.fallback(lineSchema, ''),
  when: v.fallback(lineSchema, ''),
  /** The Then of Given/When/Then: what must happen. */
  outcome: v.fallback(lineSchema, '')
})

/** "As a role, I want goal, so that benefit." */
export const storyNarrativeSchema = v.object({
  role: v.fallback(lineSchema, ''),
  goal: v.fallback(lineSchema, ''),
  benefit: v.fallback(lineSchema, '')
})

/**
 * A user story about a layer: what it is for and how it behaves, the states it covers, and the
 * criteria it is accepted by. Missing fields get defaults, so a story another tool wrote still
 * reads.
 */
export const userStorySchema = v.object({
  id: idSchema,
  epicId: v.fallback(v.nullable(idSchema), null),
  title: titleSchema,
  narrative: v.fallback(storyNarrativeSchema, { role: '', goal: '', benefit: '' }),
  acceptanceCriteria: v.fallback(v.pipe(v.array(acceptanceCriterionSchema), v.maxLength(200)), []),
  /** What the element does: its function and behaviour, in prose. */
  behaviour: v.fallback(proseSchema, ''),
  /** The states the story covers, such as default, hover, disabled, loading or error. */
  states: v.fallback(v.pipe(v.array(v.pipe(v.string(), v.maxLength(100))), v.maxLength(50)), []),
  priority: v.fallback(v.picklist(STORY_PRIORITIES), 'medium'),
  status: v.fallback(v.picklist(STORY_STATUSES), 'draft'),
  ...jiraLinkFields
})

/** Every readable entry of a list; one entry that cannot be read is left out, not the list. */
function lenientList<T>(item: v.GenericSchema<unknown, T>, max: number) {
  return v.pipe(
    v.array(v.unknown()),
    v.transform((items) =>
      items.slice(0, max).flatMap((entry) => {
        const parsed = v.safeParse(item, entry)
        return parsed.success ? [parsed.output] : []
      })
    )
  )
}

/** A document's epics, on the DOCUMENT node. */
export const epicsSchema = lenientList(epicSchema, 1000)

/** A layer's stories, in the order the layer lists them. */
export const userStoriesSchema = lenientList(userStorySchema, 500)

/** The Jira project a document's stories are created in; never a credential. */
export const storyJiraProjectSchema = v.object({
  /** The site's address, such as `https://example.atlassian.net`. */
  site: v.pipe(v.string(), v.url(), v.maxLength(500)),
  projectKey: v.pipe(v.string(), v.regex(/^[A-Z][A-Z0-9_]{0,254}$/))
})
