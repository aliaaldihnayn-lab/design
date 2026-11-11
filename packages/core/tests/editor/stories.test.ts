import { describe, expect, test } from 'bun:test'

import { createEditor } from '@lawha/core'
import { readEpics, readNodeStories } from '@lawha/scene-graph/stories'

function setup() {
  const editor = createEditor()
  const frame = editor.graph.createNode('FRAME', editor.state.currentPageId, { name: 'Screen' })
  return { editor, frame }
}

describe('story commands', () => {
  test('adding, editing and deleting a story are each one undo step', () => {
    const { editor, frame } = setup()
    const story = editor.addUserStory(frame.id, { title: 'Sign in' })
    editor.updateUserStory(frame.id, story.id, { title: 'تسجيل الدخول' })
    expect(readNodeStories(editor.graph.getNode(frame.id))[0].title).toBe('تسجيل الدخول')

    editor.undoAction()
    expect(readNodeStories(editor.graph.getNode(frame.id))[0].title).toBe('Sign in')
    editor.undoAction()
    expect(readNodeStories(editor.graph.getNode(frame.id))).toEqual([])
    editor.redoAction()
    expect(readNodeStories(editor.graph.getNode(frame.id))).toHaveLength(1)

    editor.removeUserStory(frame.id, story.id)
    expect(readNodeStories(editor.graph.getNode(frame.id))).toEqual([])
    editor.undoAction()
    expect(readNodeStories(editor.graph.getNode(frame.id))[0].id).toBe(story.id)
  })

  test('deleting an epic unlinks its stories, and undo restores both', () => {
    const { editor, frame } = setup()
    const epic = editor.addEpic({ title: 'Auth' })
    const story = editor.addUserStory(frame.id, { epicId: epic.id })
    editor.removeEpic(epic.id)
    expect(readEpics(editor.graph)).toEqual([])
    expect(readNodeStories(editor.graph.getNode(frame.id))[0].epicId).toBeNull()
    editor.undoAction()
    expect(readEpics(editor.graph)).toEqual([epic])
    expect(readNodeStories(editor.graph.getNode(frame.id))[0]).toMatchObject({
      id: story.id,
      epicId: epic.id
    })
  })

  test('undo keeps the other plugin data a layer carries', () => {
    const { editor, frame } = setup()
    editor.graph.updateNode(frame.id, {
      pluginData: [{ pluginId: 'other', key: 'k', value: 'v' }]
    })
    editor.addUserStory(frame.id)
    editor.undoAction()
    expect(editor.graph.getNode(frame.id)?.pluginData).toEqual([
      { pluginId: 'other', key: 'k', value: 'v' }
    ])
  })
})
