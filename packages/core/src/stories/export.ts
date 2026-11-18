import type { SceneGraph } from '@lawha/scene-graph'
import { storyStatement, type UserStory } from '@lawha/scene-graph/stories'

import { nonEmptyGroups, storyReport, type ReportedStory, type StoryGroup } from './report'

const PRIORITY_LABELS: Record<UserStory['priority'], string> = {
  highest: 'Highest',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  lowest: 'Lowest'
}

const STATUS_LABELS: Record<UserStory['status'], string> = {
  draft: 'Draft',
  ready: 'Ready',
  'in-progress': 'In progress',
  'in-review': 'In review',
  done: 'Done'
}

export interface StoryExportOptions {
  /** The heading of the Markdown document. */
  title?: string
  /** Lists epics that have no stories under `rootIds` too. */
  keepEmptyEpics?: boolean
}

/** Text that cannot start a Markdown block or break a line it sits on. */
function inline(text: string): string {
  return text.replace(/\s*\n\s*/g, ' ').trim()
}

function linked(text: string, key: string | undefined, url: string | undefined): string {
  if (!key) return text
  return url ? `${text} ([${key}](${url}))` : `${text} (${key})`
}

/** "Given …, when …, then …", leaving out the clauses not written yet. */
export function criterionText(criterion: UserStory['acceptanceCriteria'][number]): string {
  const parts: string[] = []
  if (criterion.given.trim()) parts.push(`Given ${inline(criterion.given)}`)
  if (criterion.when.trim()) parts.push(`when ${inline(criterion.when)}`)
  if (criterion.outcome.trim()) parts.push(`then ${inline(criterion.outcome)}`)
  return parts.join(', ')
}

function storyMarkdown({ story, path, pageName }: ReportedStory): string[] {
  const lines = [
    `### ${linked(inline(story.title) || 'Untitled story', story.jiraKey, story.jiraUrl)}`,
    ''
  ]
  const where = [pageName, ...path].filter((part) => part !== '').join(' › ')
  const facts = [
    `**Layer:** ${inline(where)}`,
    `**Priority:** ${PRIORITY_LABELS[story.priority]}`,
    `**Status:** ${STATUS_LABELS[story.status]}`
  ]
  if (story.jira) {
    const assignee = story.jira.assignee ? `, ${inline(story.jira.assignee)}` : ''
    facts.push(`**Jira:** ${inline(story.jira.status)}${assignee}`)
  }
  lines.push(facts.join(' · '), '')
  const statement = storyStatement(story.narrative)
  if (statement) lines.push(`> ${inline(statement)}`, '')
  if (story.behaviour.trim()) lines.push('**Behaviour**', '', story.behaviour.trim(), '')
  if (story.states.length > 0) lines.push(`**States:** ${story.states.map(inline).join(', ')}`, '')
  if (story.acceptanceCriteria.length > 0) {
    lines.push('**Acceptance criteria**', '')
    story.acceptanceCriteria.forEach((criterion, index) => {
      lines.push(`${index + 1}. ${criterionText(criterion)}`)
    })
    lines.push('')
  }
  return lines
}

function groupMarkdown(group: StoryGroup): string[] {
  const lines: string[] = []
  if (group.epic) {
    const title = inline(group.epic.title) || 'Untitled epic'
    lines.push(`## Epic: ${linked(title, group.epic.jiraKey, group.epic.jiraUrl)}`, '')
    if (group.epic.description.trim()) lines.push(group.epic.description.trim(), '')
  } else {
    lines.push('## Stories without an epic', '')
  }
  for (const story of group.stories) lines.push(...storyMarkdown(story))
  return lines
}

/** The stories on `rootIds` (the whole document when empty) as a Markdown spec. */
export function storiesToMarkdown(
  graph: SceneGraph,
  rootIds?: readonly string[],
  options: StoryExportOptions = {}
): string {
  const groups = nonEmptyGroups(storyReport(graph, rootIds), options.keepEmptyEpics)
  const lines = [`# ${inline(options.title ?? 'User stories')}`, '']
  if (groups.length === 0) lines.push('No user stories yet.', '')
  for (const group of groups) lines.push(...groupMarkdown(group))
  return `${lines.join('\n').trimEnd()}\n`
}

export const STORY_CSV_COLUMNS = [
  'Epic',
  'Epic Jira key',
  'Story ID',
  'Title',
  'As a',
  'I want',
  'So that',
  'Behaviour',
  'States',
  'Acceptance criteria',
  'Priority',
  'Status',
  'Page',
  'Layer path',
  'Layer ID',
  'Jira key',
  'Jira URL',
  'Jira status',
  'Assignee'
] as const

/**
 * One CSV field (RFC 4180). A value a spreadsheet would run as a formula is prefixed with a
 * quote, so opening an export never executes text someone typed into a story.
 */
export function csvField(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

/** The stories on `rootIds` (the whole document when empty), one CSV row each. */
export function storiesToCSV(graph: SceneGraph, rootIds?: readonly string[]): string {
  const rows: string[][] = [[...STORY_CSV_COLUMNS]]
  for (const group of storyReport(graph, rootIds)) {
    for (const { story, path, pageName, nodeId } of group.stories) {
      rows.push([
        group.epic?.title ?? '',
        group.epic?.jiraKey ?? '',
        story.id,
        story.title,
        story.narrative.role,
        story.narrative.goal,
        story.narrative.benefit,
        story.behaviour,
        story.states.join('; '),
        story.acceptanceCriteria.map(criterionText).join('\n'),
        PRIORITY_LABELS[story.priority],
        STATUS_LABELS[story.status],
        pageName,
        path.join(' / '),
        nodeId,
        story.jiraKey ?? '',
        story.jiraUrl ?? '',
        story.jira?.status ?? '',
        story.jira?.assignee ?? ''
      ])
    }
  }
  return `${rows.map((row) => row.map(csvField).join(',')).join('\r\n')}\r\n`
}
