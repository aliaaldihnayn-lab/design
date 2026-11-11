import { describe, expect, test } from 'bun:test'

import { SceneGraph } from '@lawha/scene-graph'

import type { AIModelRuntime } from '@/app/ai/models'
import type { EditorStore } from '@/app/editor/active-store'
import { draftStoriesForFrame, type StoryDraftDependencies } from '@/app/stories/draft'

import { asDouble } from '#tests/helpers/doubles'

function screen() {
  const graph = new SceneGraph()
  const [page] = graph.getPages()
  const frame = graph.createNode('FRAME', page.id, { name: 'Checkout' })
  const button = graph.createNode('FRAME', frame.id, { name: 'Pay Button' })
  return { store: asDouble<EditorStore>({ graph }), frame, button }
}

const runtime = asDouble<AIModelRuntime>({
  kind: 'direct',
  model: {},
  role: { profile: { maxOutputTokens: 4000 }, connection: { providerID: 'openai' } }
})

function deps(reply: string, prompts: string[] = []): StoryDraftDependencies {
  return {
    createRuntime: async () => runtime,
    generate: asDouble<StoryDraftDependencies['generate']>(
      async (options: { messages: Array<{ content: string }> }) => {
        prompts.push(options.messages[0].content)
        return { text: reply }
      }
    )
  }
}

describe('drafting stories with the AI model', () => {
  test('sends the frame and its elements, and returns a draft without touching the document', async () => {
    const { store, frame, button } = screen()
    const prompts: string[] = []
    const reply = JSON.stringify({
      epics: [{ title: 'Checkout', description: '' }],
      stories: [{ layer: button.id, title: 'Pay', epic: 'Checkout' }]
    })
    const result = await draftStoriesForFrame(store, frame.id, deps(reply, prompts))
    expect(prompts[0]).toContain(button.id)
    expect('draft' in result && result.draft.stories[0]).toMatchObject({
      nodeId: button.id,
      epicTitle: 'Checkout'
    })
    expect(store.graph.getNode(button.id)?.pluginData).toEqual([])
  })

  test('says why there is no draft', async () => {
    const { store, frame } = screen()
    expect(await draftStoriesForFrame(store, frame.id, deps('Sorry, no.'))).toEqual({
      failure: 'unreadable'
    })
    const none: StoryDraftDependencies = { ...deps(''), createRuntime: async () => null }
    expect(await draftStoriesForFrame(store, frame.id, none)).toEqual({ failure: 'no-model' })
    const failing: StoryDraftDependencies = {
      ...deps(''),
      generate: asDouble<StoryDraftDependencies['generate']>(async () => {
        throw new Error('rate limited')
      })
    }
    expect(await draftStoriesForFrame(store, frame.id, failing)).toEqual({ failure: 'failed' })
  })
})
