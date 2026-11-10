import { describe, expect, test } from 'bun:test'

import { createEditor } from '@lawha/core'
import { exportFigFile, parseFigFile } from '@lawha/core/io/formats/fig'
import { initCodec } from '@lawha/kiwi/fig/codec'
import {
  addStory,
  createEpic,
  createUserStory,
  readEpics,
  readNodeStories,
  readStoryJiraProject,
  upsertEpic,
  writeStoryJiraProject
} from '@lawha/scene-graph/stories'

describe('.fig round trip of user stories', () => {
  test('keeps epics, every story on frames and their layers, and the Jira project', async () => {
    await initCodec()
    const editor = createEditor()
    const graph = editor.graph
    const frame = graph.createNode('FRAME', editor.state.currentPageId, { name: 'Checkout' })
    const button = graph.createNode('FRAME', frame.id, { name: 'Pay' })
    const epic = upsertEpic(
      graph,
      createEpic({
        title: 'الدفع',
        jiraKey: 'SHOP-1',
        jiraUrl: 'https://x.atlassian.net/browse/SHOP-1'
      })
    )
    const screenStory = addStory(graph, frame.id, createUserStory({ title: 'Review cart' }))
    const pay = addStory(
      graph,
      button.id,
      createUserStory({
        epicId: epic.id,
        title: 'Pay for the order',
        narrative: { role: 'shopper', goal: 'to pay', benefit: 'my order ships' },
        acceptanceCriteria: [
          { given: 'a full cart', when: 'I press Pay', outcome: 'I see a receipt' }
        ],
        behaviour: 'Submits the payment form.',
        states: ['default', 'hover', 'disabled', 'loading'],
        priority: 'high',
        status: 'ready',
        jiraKey: 'SHOP-2',
        jiraUrl: 'https://x.atlassian.net/browse/SHOP-2',
        jira: {
          status: 'In Progress',
          category: 'indeterminate',
          assignee: 'Sara',
          syncedAt: '2026-11-11T00:00:00.000Z'
        }
      })
    )
    addStory(graph, button.id, createUserStory({ title: 'Second story' }))
    writeStoryJiraProject(graph, { site: 'https://x.atlassian.net', projectKey: 'SHOP' })

    const reopened = await parseFigFile((await exportFigFile(graph)).slice().buffer)
    const byName = (name: string) => [...reopened.nodes.values()].find((node) => node.name === name)
    expect(readEpics(reopened)).toEqual([epic])
    expect(readNodeStories(byName('Checkout'))).toEqual([screenStory])
    const stories = readNodeStories(byName('Pay'))
    expect(stories).toHaveLength(2)
    expect(stories[0]).toEqual(pay)
    expect(readStoryJiraProject(reopened)).toEqual({
      site: 'https://x.atlassian.net',
      projectKey: 'SHOP'
    })
  })
})
