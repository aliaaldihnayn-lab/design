import { describe, expect, test } from 'bun:test'

import { INTERACTIONS_KEY } from '@lawha/core/prototype'
import {
  applyStoryDraft,
  findInteractiveElements,
  parseStoryDraft,
  storyDraftPrompt
} from '@lawha/core/stories'
import { SceneGraph } from '@lawha/scene-graph'
import { createEpic, readEpics, readNodeStories, upsertEpic } from '@lawha/scene-graph/stories'

function signIn() {
  const graph = new SceneGraph()
  const [page] = graph.getPages()
  const frame = graph.createNode('FRAME', page.id, { name: 'Sign in' })
  const title = graph.createNode('TEXT', frame.id, { name: 'Title', text: 'Welcome back' })
  const email = graph.createNode('FRAME', frame.id, { name: 'Email Field' })
  graph.createNode('TEXT', email.id, { name: 'Placeholder', text: 'you@example.com' })
  const button = graph.createNode('FRAME', frame.id, { name: 'Primary/Button-Large' })
  graph.createNode('TEXT', button.id, { name: 'Label', text: 'Continue' })
  const arabic = graph.createNode('FRAME', frame.id, { name: 'زر التسجيل' })
  const card = graph.createNode('FRAME', frame.id, {
    name: 'Promo',
    pluginData: [
      {
        pluginId: 'lawha',
        key: INTERACTIONS_KEY,
        value: JSON.stringify([{ trigger: { type: 'click' }, action: { type: 'back' } }])
      }
    ]
  })
  const link = graph.createNode('TEXT', frame.id, {
    name: 'Forgot',
    text: 'Forgot password?',
    styleRuns: [
      { start: 0, length: 16, style: { hyperlink: { type: 'URL', value: 'https://example.com' } } }
    ]
  })
  return { graph, frame, title, email, button, arabic, card, link }
}

describe('interactive elements', () => {
  test('finds controls by name in English and Arabic, interactions and links, not static text', () => {
    const { graph, frame, title, email, button, arabic, card, link } = signIn()
    const found = findInteractiveElements(graph, frame.id)
    const byId = new Map(found.map((element) => [element.nodeId, element]))
    expect(byId.get(email.id)?.kind).toBe('input')
    expect(byId.get(button.id)).toMatchObject({ kind: 'button', label: 'Continue' })
    expect(byId.get(arabic.id)?.kind).toBe('button')
    expect(byId.get(card.id)).toMatchObject({ kind: 'button', evidence: ['on click: back'] })
    expect(byId.get(link.id)?.kind).toBe('link')
    expect(byId.has(title.id)).toBe(false)
    // A button's label is part of the button, not a second element.
    expect(found).toHaveLength(5)
  })
})

describe('drafting', () => {
  test('the prompt names every element by id and quotes design text as data', () => {
    const { graph, frame } = signIn()
    const prompt = storyDraftPrompt({
      frame: graph.getNode(frame.id) ?? frame,
      elements: findInteractiveElements(graph, frame.id),
      epics: [createEpic({ title: 'Authentication' })],
      language: 'ar'
    })
    for (const element of findInteractiveElements(graph, frame.id))
      expect(prompt).toContain(element.nodeId)
    expect(prompt).toContain('"Authentication"')
    expect(prompt).toContain('"ar"')
  })

  test('a reply becomes a draft of stories only for the frame and its elements', () => {
    const { frame, button } = signIn()
    const allowed = new Set([frame.id, button.id])
    const reply = [
      'Here are the stories:',
      '```json',
      JSON.stringify({
        epics: [{ title: 'Authentication', description: 'Signing in' }],
        stories: [
          {
            layer: button.id,
            title: 'متابعة',
            epic: 'Authentication',
            asA: 'مستخدم',
            iWant: 'أن أتابع',
            soThat: 'أصل إلى حسابي',
            acceptanceCriteria: [{ given: 'a', when: 'b', outcome: 'c' }],
            states: ['default', 'disabled'],
            priority: 'high'
          },
          { layer: frame.id, title: 'See sign in', epic: 'Authentication' },
          { layer: '99:99', title: 'Elsewhere' }
        ]
      }),
      '```'
    ].join('\n')
    const draft = parseStoryDraft(reply, allowed)
    expect(draft?.stories.map((story) => story.nodeId)).toEqual([button.id, frame.id])
    expect(draft?.stories[0].story).toMatchObject({
      title: 'متابعة',
      priority: 'high',
      states: ['default', 'disabled']
    })
    expect(parseStoryDraft('I cannot help with that.', allowed)).toBeNull()
  })

  test('saving a draft adds the stories and reuses or creates their epics', () => {
    const { graph, frame, button } = signIn()
    const existing = upsertEpic(graph, createEpic({ title: 'Authentication' }))
    const draft = parseStoryDraft(
      JSON.stringify({
        epics: [{ title: 'Growth', description: 'Promotions' }],
        stories: [
          { layer: button.id, title: 'Continue', epic: 'authentication' },
          { layer: frame.id, title: 'Promo', epic: 'Growth' }
        ]
      }),
      new Set([frame.id, button.id])
    )
    if (!draft) throw new Error('no draft')
    expect(applyStoryDraft(graph, draft)).toBe(2)
    expect(readNodeStories(graph.getNode(button.id))[0].epicId).toBe(existing.id)
    expect(readEpics(graph).map((epic) => [epic.title, epic.description])).toEqual([
      ['Authentication', ''],
      ['Growth', 'Promotions']
    ])
  })
})
