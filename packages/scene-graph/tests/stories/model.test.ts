import { describe, expect, test } from 'bun:test'

import { SceneGraph } from '@lawha/scene-graph'
import { LAWHA_PLUGIN_DATA, withPluginData } from '@lawha/scene-graph/plugin-data'
import {
  addStory,
  collectStories,
  createEpic,
  createUserStory,
  findStory,
  readEpics,
  readNodeStories,
  readStoryJiraProject,
  removeEpic,
  removeStory,
  storyStatement,
  updateStory,
  upsertEpic,
  writeStoryJiraProject
} from '@lawha/scene-graph/stories'

function screen() {
  const graph = new SceneGraph()
  const [page] = graph.getPages()
  const frame = graph.createNode('FRAME', page.id, { name: 'Checkout' })
  const button = graph.createNode('FRAME', frame.id, { name: 'Pay button' })
  return { graph, page, frame, button }
}

describe('user stories', () => {
  test('a layer keeps many stories, in order, through its plugin data', () => {
    const { graph, button } = screen()
    const first = addStory(graph, button.id, createUserStory({ title: 'Pay' }))
    const second = addStory(graph, button.id, createUserStory({ title: 'Disabled' }))
    expect(readNodeStories(graph.getNode(button.id)).map((story) => story.id)).toEqual([
      first.id,
      second.id
    ])
  })

  test('new stories get defaults and distinct ids', () => {
    const a = createUserStory()
    const b = createUserStory()
    expect(a.id).not.toBe(b.id)
    expect(a).toMatchObject({ epicId: null, priority: 'medium', status: 'draft', states: [] })
  })

  test('updates change only the story they name and keep its id', () => {
    const { graph, button } = screen()
    const story = addStory(graph, button.id, createUserStory({ title: 'Pay' }))
    const other = addStory(graph, button.id, createUserStory({ title: 'Other' }))
    updateStory(graph, button.id, story.id, {
      title: 'ادفع الآن',
      acceptanceCriteria: [{ id: 'c1', given: 'a cart', when: 'I press Pay', outcome: 'I pay' }],
      jiraKey: 'SHOP-12'
    })
    const [updated, untouched] = readNodeStories(graph.getNode(button.id))
    expect(updated).toMatchObject({ id: story.id, title: 'ادفع الآن', jiraKey: 'SHOP-12' })
    expect(updated.acceptanceCriteria).toHaveLength(1)
    expect(untouched).toEqual(other)
    expect(updateStory(graph, button.id, 'missing', { title: 'x' })).toBeUndefined()
  })

  test('removing the last story removes the plugin-data entry', () => {
    const { graph, button } = screen()
    const story = addStory(graph, button.id, createUserStory())
    expect(removeStory(graph, button.id, story.id)).toBe(true)
    expect(graph.getNode(button.id)?.pluginData).toEqual([])
  })

  test('collects a frame and the layers inside it in layer order', () => {
    const { graph, frame, button } = screen()
    const inner = addStory(graph, button.id, createUserStory({ title: 'inner' }))
    const outer = addStory(graph, frame.id, createUserStory({ title: 'outer' }))
    expect(collectStories(graph, frame.id)).toEqual([
      { nodeId: frame.id, story: outer },
      { nodeId: button.id, story: inner }
    ])
    expect(findStory(graph, inner.id)?.nodeId).toBe(button.id)
  })

  test('epics live on the document node, and removing one unlinks its stories', () => {
    const { graph, button } = screen()
    const epic = upsertEpic(graph, createEpic({ title: 'Checkout' }))
    const story = addStory(graph, button.id, createUserStory({ epicId: epic.id }))
    expect(readEpics(graph)).toEqual([epic])
    expect(removeEpic(graph, epic.id)).toBe(true)
    expect(readEpics(graph)).toEqual([])
    expect(findStory(graph, story.id)?.story.epicId).toBeNull()
  })

  test('an unreadable story is skipped without hiding the others', () => {
    const { graph, button } = screen()
    const good = createUserStory({ title: 'Good' })
    const node = graph.getNode(button.id)
    if (!node) throw new Error('missing node')
    graph.updateNode(button.id, {
      pluginData: [
        {
          pluginId: 'lawha',
          key: LAWHA_PLUGIN_DATA.userStories.key,
          value: JSON.stringify([
            { title: 'no id' },
            good,
            { id: 'x', title: 'bad', jiraKey: 'nope' }
          ])
        }
      ]
    })
    const stories = readNodeStories(graph.getNode(button.id))
    expect(stories.map((story) => story.title)).toEqual(['Good', 'bad'])
    // A malformed Jira key is dropped rather than the story.
    expect(stories[1].jiraKey).toBeUndefined()
    expect(withPluginData(node.pluginData, LAWHA_PLUGIN_DATA.userStories, undefined)).toEqual([])
  })

  test('the Jira project is stored on the document without credentials', () => {
    const { graph } = screen()
    writeStoryJiraProject(graph, { site: 'https://example.atlassian.net', projectKey: 'SHOP' })
    expect(readStoryJiraProject(graph)).toEqual({
      site: 'https://example.atlassian.net',
      projectKey: 'SHOP'
    })
    writeStoryJiraProject(graph, undefined)
    expect(readStoryJiraProject(graph)).toBeUndefined()
  })

  test('the statement leaves out parts not written yet', () => {
    expect(storyStatement({ role: 'shopper', goal: 'to pay', benefit: 'I get my order' })).toBe(
      'As a shopper, I want to pay, so that I get my order.'
    )
    expect(storyStatement({ role: '', goal: 'to pay', benefit: '' })).toBe('I want to pay.')
    expect(storyStatement({ role: '', goal: '', benefit: '' })).toBe('')
  })
})
