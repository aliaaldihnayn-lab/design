import { storyStatement, type Epic, type UserStory } from '@lawha/scene-graph/stories'

import { criterionText } from '#core/stories/export'

/**
 * Atlassian Document Format, the rich text Jira Cloud's REST API v3 takes for descriptions:
 * a `doc` of block nodes holding text nodes. Only the nodes the stories write are typed here.
 */
export interface ADFText {
  type: 'text'
  text: string
  marks?: Array<{ type: 'strong' } | { type: 'link'; attrs: { href: string } }>
}

export type ADFBlock =
  | { type: 'paragraph'; content: ADFText[] }
  | { type: 'heading'; attrs: { level: 1 | 2 | 3 | 4 | 5 | 6 }; content: ADFText[] }
  | { type: 'bulletList' | 'orderedList'; content: ADFListItem[] }

export interface ADFListItem {
  type: 'listItem'
  content: Array<{ type: 'paragraph'; content: ADFText[] }>
}

export interface ADFDocument {
  type: 'doc'
  version: 1
  content: ADFBlock[]
}

const text = (value: string): ADFText => ({ type: 'text', text: value })

/** ADF rejects empty text nodes, so an empty line becomes an empty paragraph. */
function paragraph(value: string): ADFBlock {
  return { type: 'paragraph', content: value ? [text(value)] : [] }
}

function heading(value: string): ADFBlock {
  return { type: 'heading', attrs: { level: 3 }, content: [text(value)] }
}

function list(kind: 'bulletList' | 'orderedList', items: string[]): ADFBlock {
  return {
    type: kind,
    content: items.map((item) => ({
      type: 'listItem',
      content: [{ type: 'paragraph', content: [text(item)] }]
    }))
  }
}

/** Prose as paragraphs, one per blank-line-separated block. */
function prose(value: string): ADFBlock[] {
  return value
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0)
    .map(paragraph)
}

export interface StoryDescriptionContext {
  /** Layer names from the frame down to the story's layer. */
  path: string[]
  pageName?: string
}

/**
 * A story's Jira description: the "As a … I want … so that …" statement, the acceptance
 * criteria as a numbered list of Given/When/Then, the behaviour, the states covered and where
 * the story lives in the design.
 */
export function storyDescription(story: UserStory, context: StoryDescriptionContext): ADFDocument {
  const content: ADFBlock[] = []
  const statement = storyStatement(story.narrative)
  if (statement) content.push(paragraph(statement))
  if (story.acceptanceCriteria.length > 0) {
    content.push(heading('Acceptance criteria'))
    content.push(
      list(
        'orderedList',
        story.acceptanceCriteria.map(criterionText).map((line) => line || '—')
      )
    )
  }
  if (story.behaviour.trim()) content.push(heading('Behaviour'), ...prose(story.behaviour))
  if (story.states.length > 0) {
    content.push(heading('States covered'), list('bulletList', story.states))
  }
  const where = [context.pageName ?? '', ...context.path].filter((part) => part !== '').join(' › ')
  if (where) {
    content.push(heading('Design'), {
      type: 'paragraph',
      content: [{ type: 'text', text: 'Layer: ', marks: [{ type: 'strong' }] }, text(where)]
    })
  }
  return { type: 'doc', version: 1, content }
}

/** An epic's Jira description: its own description, as paragraphs. */
export function epicDescription(epic: Epic): ADFDocument {
  return { type: 'doc', version: 1, content: prose(epic.description) }
}
