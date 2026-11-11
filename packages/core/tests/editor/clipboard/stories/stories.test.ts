import { afterEach, describe, expect, test } from 'bun:test'

import { expectDefined } from '#core-tests/helpers/assert'

import { createEditor, type Editor } from '@lawha/core'
import { createUserStory, readNodeStories } from '@lawha/scene-graph/stories'

let editor: Editor

afterEach(() => editor.dispose())

const ISSUE_URL = 'https://example.atlassian.net/browse/SHOP-12'
const synced = {
  status: 'In Progress',
  category: 'indeterminate' as const,
  assignee: null,
  syncedAt: '2026-11-01T00:00:00.000Z'
}

function setup() {
  editor = createEditor()
  const epic = editor.addEpic({ title: 'Checkout' })
  const frame = editor.graph.createNode('FRAME', editor.state.currentPageId, {
    name: 'Checkout',
    width: 100,
    height: 100
  })
  const button = editor.graph.createNode('FRAME', frame.id, { name: 'Pay', width: 40, height: 20 })
  for (const [id, key] of [
    [frame.id, 'SHOP-11'],
    [button.id, 'SHOP-12']
  ] as const) {
    editor.addUserStory(
      id,
      createUserStory({
        title: 'Pay',
        epicId: epic.id,
        acceptanceCriteria: [{ given: 'a cart', when: 'I pay', outcome: 'the order is placed' }],
        jiraKey: key,
        jiraUrl: ISSUE_URL,
        jira: synced
      })
    )
  }
  return { epic, frame, button }
}

describe('a duplicate of a layer with user stories', () => {
  test('gets stories of its own, with new ids and no Jira issue', () => {
    const { epic, frame, button } = setup()
    editor.select([frame.id])
    editor.duplicateSelected()
    const copy = expectDefined(editor.graph.getNode([...editor.state.selectedIds][0]))
    expect(copy.id).not.toBe(frame.id)
    const copyButton = expectDefined(editor.graph.getNode(copy.childIds[0]))

    for (const [source, duplicate] of [
      [frame.id, copy.id],
      [button.id, copyButton.id]
    ]) {
      const [original] = readNodeStories(editor.graph.getNode(source))
      const [story] = readNodeStories(editor.graph.getNode(duplicate))
      expect(story.id).not.toBe(original.id)
      expect(story.acceptanceCriteria[0].id).not.toBe(original.acceptanceCriteria[0].id)
      expect(story).toMatchObject({ title: 'Pay', epicId: epic.id })
      expect(story.acceptanceCriteria[0]).toMatchObject({ given: 'a cart', when: 'I pay' })
      expect(story.jiraKey).toBeUndefined()
      expect(story.jiraUrl).toBeUndefined()
      expect(story.jira).toBeUndefined()
      // The original keeps its issue.
      expect(original.jiraKey).toMatch(/^SHOP-1[12]$/)
      expect(original.jiraUrl).toBe(ISSUE_URL)
    }
  })
})
