import { describe, expect, test } from 'bun:test'

import { FigmaAPI } from '@lawha/core/figma-api'
import { SceneGraph } from '@lawha/scene-graph'

import { setPluginData } from '#core/figma-api/plugin-data'
import { noodle, noodleAt, noodlePoint, prototypeConnections } from '#core/prototype/connections'
import { INTERACTIONS_KEY, readInteractions } from '#core/prototype/model'
import { editConnection } from '#core/tools/prototype'

function screens() {
  const graph = new SceneGraph()
  const page = graph.getPages()[0].id
  const frame = (name: string, x: number) =>
    graph.createNode('FRAME', page, { name, x, y: 0, width: 300, height: 600 })
  const home = frame('Home', 0)
  const detail = frame('Detail', 400)
  const settings = frame('Settings', 800)
  const button = graph.createNode('FRAME', home.id, { name: 'Open', width: 100, height: 40 })
  setPluginData(
    graph,
    button,
    INTERACTIONS_KEY,
    JSON.stringify([
      { trigger: { type: 'hover' }, action: { type: 'back' } },
      {
        trigger: { type: 'click' },
        action: {
          type: 'navigate',
          destination: detail.id,
          transition: { type: 'smart-animate', duration: 400 }
        }
      }
    ])
  )
  return { graph, page, home, detail, settings, button }
}

describe('editing connections on the canvas', () => {
  test('a click near a noodle picks it, and far from every noodle picks none', () => {
    const a = noodle(
      { x: 0, y: 0, width: 100, height: 40 },
      { x: 300, y: 0, width: 100, height: 400 }
    )
    const b = noodle(
      { x: 0, y: 300, width: 100, height: 40 },
      { x: 300, y: 0, width: 100, height: 400 }
    )
    const middle = noodlePoint(b, 0.5)
    expect(noodleAt([a, b], { x: middle.x + 3, y: middle.y }, 6)).toBe(1)
    expect(noodleAt([a, b], noodlePoint(a, 0.2), 6)).toBe(0)
    expect(noodleAt([a, b], { x: 200, y: 1000 }, 6)).toBeNull()
  })

  test('connections name their interaction, which edit_connection retargets or removes', () => {
    const s = screens()
    const figma = new FigmaAPI(s.graph)
    const [link] = prototypeConnections(s.graph, s.page)
    expect(link).toMatchObject({ source: s.button.id, target: s.detail.id, interaction: 1 })

    expect(
      editConnection.execute(figma, {
        id: s.button.id,
        interaction: 1,
        change: 'retarget',
        destination: s.settings.id
      })
    ).toMatchObject({ destination: s.settings.id })
    const node = s.graph.getNode(s.button.id)
    if (!node) throw new Error('missing')
    const kept = readInteractions(node, s.graph)
    // The trigger, action kind and transition stay; only where it goes changes.
    expect(kept[1]).toMatchObject({
      trigger: { type: 'click' },
      action: {
        type: 'navigate',
        destination: s.settings.id,
        transition: { type: 'smart-animate', duration: 400 }
      }
    })
    expect(prototypeConnections(s.graph, s.page).map((c) => c.target)).toEqual([s.settings.id])

    editConnection.execute(figma, { id: s.button.id, interaction: 1, change: 'remove' })
    expect(prototypeConnections(s.graph, s.page)).toEqual([])
    // The other interaction is untouched.
    expect(readInteractions(node, s.graph)).toEqual([
      { trigger: { type: 'hover' }, action: { type: 'back' } }
    ])
  })

  test('edit_connection refuses what is not a connection', () => {
    const s = screens()
    const figma = new FigmaAPI(s.graph)
    expect(
      editConnection.execute(figma, { id: s.button.id, interaction: 0, change: 'remove' })
    ).toEqual({ error: `Layer ${s.button.id} has no connection 0` })
    expect(
      editConnection.execute(figma, {
        id: s.button.id,
        interaction: 1,
        change: 'retarget',
        destination: 'missing'
      })
    ).toEqual({ error: 'Destination missing not found' })
  })
})
