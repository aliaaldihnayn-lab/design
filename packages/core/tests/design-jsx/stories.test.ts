import { describe, expect, test } from 'bun:test'

import { getNodeOrThrow } from '#core-tests/helpers/assert'

import { renderJSX } from '@lawha/core/design-jsx'
import { sceneNodeToJSX } from '@lawha/design-jsx'
import { SceneGraph } from '@lawha/scene-graph'
import {
  createEpic,
  readEpics,
  readNodeStories,
  updateStory,
  upsertEpic
} from '@lawha/scene-graph/stories'

describe('user stories in design JSX', () => {
  test('a screen arrives with its epics and each element with its stories', async () => {
    const graph = new SceneGraph()
    const existing = upsertEpic(graph, createEpic({ title: 'Checkout' }))
    const [screen] = await renderJSX(
      graph,
      `
      <Frame name="Sign in" w={390} h={844} flex="col" gap={12}
        epics={[{ title: 'Authentication', description: 'Signing in and out' }]}
        stories={[{ title: 'See the sign-in screen', epic: 'Authentication', asA: 'returning user', iWant: 'to sign in', soThat: 'I see my orders' }]}>
        <Frame name="Email field" w="fill" h={44}
          stories={[{
            title: 'Enter my email',
            epic: 'authentication',
            criteria: [
              { given: 'the field is empty', when: 'I type a@b.co', then: 'the field shows it' },
              'Given an invalid address, when I leave the field, then an error shows'
            ],
            behaviour: 'Validates on blur.',
            states: ['default', 'focused', 'error', 'disabled'],
            priority: 'high'
          }]} />
        <Frame name="Pay" w={120} h={44} stories={[{ title: 'Pay', epic: 'Checkout' }]} />
      </Frame>
    `
    )
    const root = getNodeOrThrow(graph, screen.id)
    const [field, pay] = root.childIds.map((id) => getNodeOrThrow(graph, id))

    const epics = readEpics(graph)
    expect(epics.map((epic) => epic.title)).toEqual(['Checkout', 'Authentication'])
    const auth = epics[1]
    expect(auth.description).toBe('Signing in and out')

    expect(readNodeStories(root)).toMatchObject([
      {
        title: 'See the sign-in screen',
        epicId: auth.id,
        narrative: { role: 'returning user', goal: 'to sign in', benefit: 'I see my orders' }
      }
    ])
    const [email] = readNodeStories(field)
    // Epic titles match without regard to case.
    expect(email.epicId).toBe(auth.id)
    expect(
      email.acceptanceCriteria.map(({ given, when, outcome }) => ({ given, when, outcome }))
    ).toEqual([
      { given: 'the field is empty', when: 'I type a@b.co', outcome: 'the field shows it' },
      { given: 'an invalid address', when: 'I leave the field', outcome: 'an error shows' }
    ])
    expect(email).toMatchObject({
      states: ['default', 'focused', 'error', 'disabled'],
      priority: 'high'
    })
    expect(readNodeStories(pay)[0].epicId).toBe(existing.id)
  })

  test('a story that is not readable fails the render with what is wrong', async () => {
    const graph = new SceneGraph()
    await expect(
      renderJSX(graph, `<Frame stories={[{ title: 'x', priority: 'urgent' }]} />`)
    ).rejects.toThrow(/stories/)
  })

  test('JSX export writes the stories and their epics back out, and they render again', async () => {
    const graph = new SceneGraph()
    const [screen] = await renderJSX(
      graph,
      `
      <Frame name="Checkout" w={390} h={200}
        stories={[{
          title: 'Pay for the order',
          epic: { title: 'Payments', description: 'Paying for orders' },
          asA: 'shopper', iWant: 'to pay', soThat: 'my order ships',
          criteria: [{ given: 'a full cart', when: 'I press Pay', then: 'I see a receipt' }],
          behaviour: 'Submits the payment form.',
          states: ['default', 'loading'],
          priority: 'high',
          status: 'ready'
        }]} />
    `
    )
    const code = sceneNodeToJSX(screen.id, graph)
    expect(code).toContain('stories=')

    const copy = new SceneGraph()
    const [again] = await renderJSX(copy, code)
    const [original] = readNodeStories(getNodeOrThrow(graph, screen.id))
    const [restored] = readNodeStories(getNodeOrThrow(copy, again.id))
    const { id: _id, epicId: _epic, acceptanceCriteria, ...content } = original
    expect(restored).toMatchObject({
      ...content,
      acceptanceCriteria: acceptanceCriteria.map(({ id: _criterion, ...criterion }) => criterion)
    })
    expect(readEpics(copy)).toMatchObject([{ title: 'Payments', description: 'Paying for orders' }])
    expect(restored.epicId).toBe(readEpics(copy)[0].id)
  })

  test('JSX export leaves out the Jira issue, as a copy does', async () => {
    const graph = new SceneGraph()
    const [screen] = await renderJSX(
      graph,
      `<Frame name="Pay" w={10} h={10} stories={[{ title: 'Pay' }]} />`
    )
    const [story] = readNodeStories(getNodeOrThrow(graph, screen.id))
    updateStory(graph, screen.id, story.id, {
      jiraKey: 'SHOP-1',
      jiraUrl: 'https://x.atlassian.net/browse/SHOP-1'
    })
    const code = sceneNodeToJSX(screen.id, graph)
    expect(code).not.toContain('SHOP-1')
    const copy = new SceneGraph()
    const [again] = await renderJSX(copy, code)
    const [restored] = readNodeStories(getNodeOrThrow(copy, again.id))
    expect(restored).toMatchObject({ title: 'Pay', priority: 'medium', status: 'draft' })
    expect(restored.jiraKey).toBeUndefined()
  })
})
