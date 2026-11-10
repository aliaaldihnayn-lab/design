import { describe, expect, test } from 'bun:test'

import { FigmaAPI } from '@lawha/core/figma-api'
import { SceneGraph } from '@lawha/scene-graph'

import { setPluginData } from '#core/figma-api/plugin-data'
import { noodle, noodlePath, prototypeConnections, screenAt } from '#core/prototype/connections'
import { INTERACTIONS_KEY } from '#core/prototype/model'
import {
  readScroll,
  SCROLL_KEY,
  scrollContentGraph,
  scrollRegions,
  scrollTarget
} from '#core/prototype/scroll'
import { setScrollBehavior } from '#core/tools/prototype'

function feed() {
  const graph = new SceneGraph()
  const page = graph.getPages()[0].id
  const screen = graph.createNode('FRAME', page, {
    name: 'Feed',
    x: 100,
    y: 50,
    width: 390,
    height: 844
  })
  const list = graph.createNode('FRAME', screen.id, {
    name: 'List',
    x: 0,
    y: 100,
    width: 390,
    height: 600,
    clipsContent: true
  })
  const items = Array.from({ length: 10 }, (_, i) =>
    graph.createNode('FRAME', list.id, {
      name: `Item ${i}`,
      x: 0,
      y: i * 120,
      width: 390,
      height: 110
    })
  )
  return { graph, page, screen, list, items }
}

describe('scrolling frames', () => {
  test('a frame set to scroll reports its content extent on its screen', () => {
    const s = feed()
    expect(scrollRegions(s.graph, s.screen.id)).toEqual([])
    const node = s.graph.getNode(s.list.id)
    if (!node) throw new Error('missing')
    setPluginData(s.graph, node, SCROLL_KEY, 'vertical')
    expect(readScroll(node)).toBe('vertical')
    expect(scrollRegions(s.graph, s.screen.id)).toEqual([
      {
        node: s.list.id,
        direction: 'vertical',
        x: 0,
        y: 100,
        width: 390,
        height: 600,
        contentWidth: 390,
        contentHeight: 1190
      }
    ])
    const regions = scrollRegions(s.graph, s.screen.id)
    expect(scrollTarget(s.graph, regions, s.items[7].id)).toMatchObject({ x: 0, y: 840 })
    expect(scrollTarget(s.graph, regions, s.screen.id)).toBeNull()

    const content = scrollContentGraph(s.graph, regions[0])
    expect(content?.graph.getNode(s.list.id)).toMatchObject({ width: 390, height: 1190 })
    expect(s.graph.getNode(s.list.id)?.height).toBe(600)
  })

  test('a frame that does not clip, or a malformed value, does not scroll', () => {
    const s = feed()
    s.graph.updateNode(s.list.id, { clipsContent: false })
    const node = s.graph.getNode(s.list.id)
    if (!node) throw new Error('missing')
    setPluginData(s.graph, node, SCROLL_KEY, 'vertical')
    expect(scrollRegions(s.graph, s.screen.id)).toEqual([])
    setPluginData(s.graph, node, SCROLL_KEY, 'sideways')
    expect(readScroll(node)).toBe('none')
  })

  test('set_scroll_behavior turns on clipping and refuses layers that cannot scroll', () => {
    const figma = new FigmaAPI(new SceneGraph())
    const frame = figma.createFrame()
    frame.clipsContent = false
    const rect = figma.createRectangle()
    expect(setScrollBehavior.execute(figma, { id: frame.id, direction: 'both' })).toEqual({
      id: frame.id,
      direction: 'both'
    })
    expect(frame.clipsContent).toBe(true)
    expect(frame.getPluginData(SCROLL_KEY)).toBe('both')
    expect(setScrollBehavior.execute(figma, { id: rect.id, direction: 'vertical' })).toEqual({
      error: 'Only frames, components and instances scroll'
    })
    setScrollBehavior.execute(figma, { id: frame.id, direction: 'none' })
    expect(frame.getPluginData(SCROLL_KEY)).toBe('')
  })
})

describe('connections', () => {
  test('lists every link to a layer and finds the screen under a point', () => {
    const s = feed()
    const other = s.graph.createNode('FRAME', s.page, {
      name: 'Detail',
      x: 600,
      y: 50,
      width: 390,
      height: 844
    })
    const item = s.graph.getNode(s.items[0].id)
    if (!item) throw new Error('missing')
    setPluginData(
      s.graph,
      item,
      INTERACTIONS_KEY,
      JSON.stringify([
        {
          trigger: { type: 'click' },
          action: { type: 'navigate', destination: other.id, transition: { type: 'smart-animate' } }
        },
        { trigger: { type: 'hover' }, action: { type: 'back' } }
      ])
    )
    expect(prototypeConnections(s.graph, s.page)).toEqual([
      { source: item.id, target: other.id, kind: 'navigate', trigger: 'click' }
    ])
    expect(screenAt(s.graph, s.page, { x: 700, y: 100 })).toBe(other.id)
    expect(screenAt(s.graph, s.page, { x: 150, y: 100 })).toBe(s.screen.id)
    expect(screenAt(s.graph, s.page, { x: 520, y: 100 })).toBeNull()
  })

  test('a noodle leaves the facing side and ends in an arrow on the target', () => {
    const line = noodle(
      { x: 0, y: 0, width: 100, height: 40 },
      { x: 300, y: 100, width: 200, height: 400 }
    )
    expect(line.start).toEqual({ x: 100, y: 20 })
    expect(line.end).toEqual({ x: 300, y: 112 })
    expect(line.arrow[2]).toEqual(line.end)
    expect(line.arrow[0].x).toBeLessThan(line.end.x)
    expect(noodlePath(line)).toStartWith('M 100 20 C ')
    const back = noodle(
      { x: 500, y: 0, width: 100, height: 40 },
      { x: 0, y: 0, width: 200, height: 400 }
    )
    expect(back.start.x).toBe(500)
    expect(back.end.x).toBe(200)
    expect(back.arrow[0].x).toBeGreaterThan(200)
  })
})
