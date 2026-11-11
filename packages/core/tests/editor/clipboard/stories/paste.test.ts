import { afterEach, describe, expect, test } from 'bun:test'

import { expectDefined } from '#core-tests/helpers/assert'

import { createEditor, type Editor } from '@lawha/core'
import { createUserStory, readNodeStories } from '@lawha/scene-graph/stories'

let editor: Editor

afterEach(() => editor.dispose())

function setup() {
  editor = createEditor()
  const epic = editor.addEpic({ title: 'Checkout' })
  const frame = editor.graph.createNode('FRAME', editor.state.currentPageId, {
    name: 'Checkout',
    width: 100,
    height: 100
  })
  const story = editor.addUserStory(
    frame.id,
    createUserStory({
      title: 'Pay',
      epicId: epic.id,
      acceptanceCriteria: [{ given: 'a cart', when: 'I pay', outcome: 'the order is placed' }],
      jiraKey: 'SHOP-12',
      jiraUrl: 'https://example.atlassian.net/browse/SHOP-12'
    })
  )
  return { epic, frame, story }
}

describe('a pasted layer with user stories', () => {
  test('gets stories of its own, with new ids and no Jira issue', async () => {
    const { epic, frame, story } = setup()
    editor.select([frame.id])
    const payload = await editor.prepareCopy()
    await editor.pasteSnapshot(expectDefined(payload.snapshot))
    const pastedId = expectDefined([...editor.state.selectedIds][0])
    expect(pastedId).not.toBe(frame.id)
    const [pasted] = readNodeStories(editor.graph.getNode(pastedId))
    // The paste wrote a layer of its own, not the original.
    expect(editor.graph.getNode(pastedId)?.childIds).toEqual([])
    expect(pasted.id).not.toBe(story.id)
    expect(pasted.acceptanceCriteria[0].id).not.toBe(story.acceptanceCriteria[0].id)
    expect(pasted).toMatchObject({ title: 'Pay', epicId: epic.id })
    expect(pasted.jiraKey).toBeUndefined()
    expect(pasted.jiraUrl).toBeUndefined()
    const [original] = readNodeStories(editor.graph.getNode(frame.id))
    expect(original.jiraKey).toBe('SHOP-12')
  })

  test('keeps new ids when the same copy is pasted twice', async () => {
    const { frame } = setup()
    editor.select([frame.id])
    const snapshot = expectDefined((await editor.prepareCopy()).snapshot)
    await editor.pasteSnapshot(snapshot)
    const first = readNodeStories(editor.graph.getNode([...editor.state.selectedIds][0]))[0]
    await editor.pasteSnapshot(snapshot)
    const second = readNodeStories(editor.graph.getNode([...editor.state.selectedIds][0]))[0]
    expect(first.id).not.toBe(second.id)
  })
})

describe('an instance of a component with user stories', () => {
  test('starts without the main component stories and copies them only when asked', () => {
    editor = createEditor()
    const component = editor.graph.createNode('COMPONENT', editor.state.currentPageId, {
      name: 'Button',
      width: 80,
      height: 30
    })
    const label = editor.graph.createNode('TEXT', component.id, { name: 'Label' })
    const story = editor.addUserStory(
      component.id,
      createUserStory({ title: 'Press', jiraKey: 'SHOP-1' })
    )
    editor.addUserStory(label.id, createUserStory({ title: 'Read the label' }))
    const instance = expectDefined(
      editor.graph.createInstance(component.id, editor.state.currentPageId)
    )
    expect(readNodeStories(instance)).toEqual([])
    const instanceLabel = expectDefined(editor.graph.getNode(instance.childIds[0]))
    expect(readNodeStories(instanceLabel)).toEqual([])

    expect(editor.copyMainComponentStories(instance.id)).toBe(2)
    const [copied] = readNodeStories(editor.graph.getNode(instance.id))
    expect(copied).toMatchObject({ title: 'Press' })
    expect(copied.id).not.toBe(story.id)
    expect(copied.jiraKey).toBeUndefined()
    expect(readNodeStories(editor.graph.getNode(instanceLabel.id))[0]).toMatchObject({
      title: 'Read the label'
    })
    // One undo step takes the copy back.
    editor.undoAction()
    expect(readNodeStories(editor.graph.getNode(instance.id))).toEqual([])
  })
})
