import { describe, expect, test } from 'bun:test'

import { BUILTIN_IO_FORMATS, IORegistry } from '@lawha/core/io'
import { csvField, storiesToCSV, storiesToMarkdown, storyReport } from '@lawha/core/stories'
import { SceneGraph } from '@lawha/scene-graph'
import { addStory, createEpic, createUserStory, upsertEpic } from '@lawha/scene-graph/stories'

function checkout() {
  const graph = new SceneGraph()
  const [page] = graph.getPages()
  const frame = graph.createNode('FRAME', page.id, { name: 'Checkout' })
  const button = graph.createNode('FRAME', frame.id, { name: 'Pay button' })
  const other = graph.createNode('FRAME', page.id, { name: 'Other screen' })
  const epic = upsertEpic(graph, createEpic({ title: 'Payments', jiraKey: 'SHOP-1' }))
  upsertEpic(graph, createEpic({ title: 'Empty epic' }))
  const pay = addStory(
    graph,
    button.id,
    createUserStory({
      epicId: epic.id,
      title: 'ادفع الطلب',
      narrative: { role: 'مشتري', goal: 'أن أدفع', benefit: 'يُشحن طلبي' },
      acceptanceCriteria: [
        { given: 'a full cart', when: 'I press Pay', outcome: 'I see a receipt' }
      ],
      states: ['default', 'disabled'],
      priority: 'high',
      jiraKey: 'SHOP-2',
      jiraUrl: 'https://x.atlassian.net/browse/SHOP-2'
    })
  )
  const loose = addStory(graph, frame.id, createUserStory({ title: 'Review cart' }))
  addStory(graph, other.id, createUserStory({ title: 'Elsewhere' }))
  return { graph, page, frame, button, other, epic, pay, loose }
}

describe('story report', () => {
  test('groups the stories under a frame by epic, stories without one last', () => {
    const { graph, frame, epic, pay, loose, button } = checkout()
    const groups = storyReport(graph, [frame.id])
    expect(groups.map((group) => group.epic?.id ?? null)).toEqual([
      epic.id,
      expect.any(String),
      null
    ])
    expect(groups[0].stories.map(({ story }) => story.id)).toEqual([pay.id])
    expect(groups[0].stories[0]).toMatchObject({
      nodeId: button.id,
      path: ['Checkout', 'Pay button']
    })
    expect(groups[1].stories).toEqual([])
    expect(groups[2].stories.map(({ story }) => story.id)).toEqual([loose.id])
  })

  test('the whole document when no roots are given', () => {
    const { graph } = checkout()
    const count = storyReport(graph).reduce((sum, group) => sum + group.stories.length, 0)
    expect(count).toBe(3)
  })
})

describe('Markdown', () => {
  test('lists every story of the target with its criteria, states and Jira link', () => {
    const { graph, frame } = checkout()
    const markdown = storiesToMarkdown(graph, [frame.id], { title: 'Checkout' })
    expect(markdown).toContain('ادفع الطلب')
    expect(markdown).toContain('[SHOP-2](https://x.atlassian.net/browse/SHOP-2)')
    expect(markdown).toContain('I press Pay')
    expect(markdown).toContain('disabled')
    expect(markdown).toContain('Review cart')
    expect(markdown).not.toContain('Elsewhere')
    // Epics without stories in the target are left out unless asked for.
    expect(markdown).not.toContain('Empty epic')
    expect(storiesToMarkdown(graph, [frame.id], { keepEmptyEpics: true })).toContain('Empty epic')
  })
})

describe('CSV', () => {
  test('has a header and one row per story, quoting fields that need it', () => {
    const { graph, frame } = checkout()
    const rows = storiesToCSV(graph, [frame.id]).trimEnd().split('\r\n')
    // The criteria of the first story contain a line break inside quotes, so count records.
    expect(rows[0].split(',')).toContain('Acceptance criteria')
    expect(storiesToCSV(graph, [frame.id]).match(/^[0-9a-f]{16},/gm)?.length ?? 0).toBe(0)
    expect(storiesToCSV(graph, [frame.id])).toContain(
      '"Given a full cart, when I press Pay, then I see a receipt"'
    )
  })

  test('fields are escaped and formula-like values neutralised', () => {
    expect(csvField('plain')).toBe('plain')
    expect(csvField('a,b')).toBe('"a,b"')
    expect(csvField('say "hi"')).toBe('"say ""hi"""')
    expect(csvField('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`)
    expect(csvField('-1')).toBe("'-1")
  })
})

describe('export formats', () => {
  const io = new IORegistry(BUILTIN_IO_FORMATS)

  test('Markdown and CSV export the selection and the page', async () => {
    const { graph, page, frame } = checkout()
    const markdown = await io.exportContent('stories-markdown', {
      graph,
      target: { scope: 'selection', nodeIds: [frame.id] }
    })
    expect(markdown.extension).toBe('md')
    expect(markdown.data).toContain('ادفع الطلب')
    const csv = await io.exportContent('stories-csv', {
      graph,
      target: { scope: 'page', pageId: page.id }
    })
    expect(csv.extension).toBe('csv')
    expect(typeof csv.data === 'string' && csv.data.startsWith('﻿')).toBe(true)
    expect(csv.data).toContain('Elsewhere')
  })
})
