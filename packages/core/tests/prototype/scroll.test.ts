import { describe, expect, test } from 'bun:test'

import { FigmaAPI } from '@lawha/core/figma-api'
import { SceneGraph } from '@lawha/scene-graph'

import { setPluginData } from '#core/figma-api/plugin-data'
import { noodle, noodlePath, prototypeConnections, screenAt } from '#core/prototype/connections'
import { INTERACTIONS_KEY } from '#core/prototype/model'
import {
  pinnedLayerGraph,
  pinnedLayerOf,
  POSITION_KEY,
  readPosition,
  readScroll,
  SCROLL_KEY,
  scrollContentGraph,
  scrollRegions,
  scrollTarget
} from '#core/prototype/scroll'
import { setScrollBehavior, setScrollPosition } from '#core/tools/prototype'

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
        parent: null,
        pinned: [],
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

  test('fixed and sticky children are pinned, and drawn apart from the content', () => {
    const s = feed()
    const list = s.graph.getNode(s.list.id)
    const header = s.graph.getNode(s.items[0].id)
    const tabs = s.graph.getNode(s.items[3].id)
    if (!list || !header || !tabs) throw new Error('missing')
    setPluginData(s.graph, list, SCROLL_KEY, 'vertical')
    setPluginData(s.graph, header, POSITION_KEY, 'fixed')
    setPluginData(s.graph, tabs, POSITION_KEY, 'sticky')
    expect(readPosition(header)).toBe('fixed')
    const [region] = scrollRegions(s.graph, s.screen.id)
    expect(region.pinned).toEqual([
      { node: header.id, mode: 'fixed', x: 0, y: 0, width: 390, height: 110 },
      { node: tabs.id, mode: 'sticky', x: 0, y: 360, width: 390, height: 110 }
    ])
    const inner = s.graph.createNode('FRAME', tabs.id, { name: 'Tab', width: 50, height: 20 })
    expect(pinnedLayerOf(s.graph, region, inner.id)?.node).toBe(tabs.id)
    expect(pinnedLayerOf(s.graph, region, s.items[5].id)).toBeNull()
    const content = scrollContentGraph(s.graph, region, [region])
    expect(content?.graph.getNode(header.id)?.visible).toBe(false)
    expect(content?.graph.getNode(tabs.id)?.visible).toBe(false)
    expect(content?.graph.getNode(s.items[5].id)?.visible).toBe(true)
    expect(pinnedLayerGraph(s.graph, region.pinned[0])?.graph.getNode(header.id)).toBeDefined()
  })

  test('a scrolling frame inside another scrolls on its own, in its parent’s content', () => {
    const s = feed()
    const list = s.graph.getNode(s.list.id)
    if (!list) throw new Error('missing')
    setPluginData(s.graph, list, SCROLL_KEY, 'vertical')
    const carousel = s.graph.createNode('FRAME', s.items[2].id, {
      name: 'Carousel',
      x: 10,
      y: 5,
      width: 300,
      height: 100,
      clipsContent: true
    })
    const card = s.graph.createNode('FRAME', carousel.id, {
      name: 'Card 3',
      x: 700,
      y: 0,
      width: 200,
      height: 100
    })
    setPluginData(s.graph, carousel, SCROLL_KEY, 'horizontal')
    const regions = scrollRegions(s.graph, s.screen.id)
    expect(regions.map((r) => [r.node, r.parent])).toEqual([
      [s.list.id, null],
      [carousel.id, s.list.id]
    ])
    // Placed in the list's content: item 2 sits at 240, the carousel 5 below.
    expect(regions[1]).toMatchObject({ x: 10, y: 245, contentWidth: 900, direction: 'horizontal' })
    // A layer in the carousel scrolls with the carousel, not the list.
    expect(scrollTarget(s.graph, regions, card.id)).toMatchObject({
      region: { node: carousel.id },
      x: 700,
      y: 0
    })
    // The list's content leaves out what the carousel draws itself, but keeps the carousel.
    const content = scrollContentGraph(s.graph, regions[0], regions)
    expect(content?.graph.getNode(card.id)?.visible).toBe(false)
    expect(content?.graph.getNode(carousel.id)?.visible).toBe(true)
  })

  test('set_scroll_position stores fixed and sticky, and says when the parent does not scroll', () => {
    const s = feed()
    const figma = new FigmaAPI(s.graph)
    expect(
      setScrollPosition.execute(figma, { id: s.items[0].id, position: 'fixed' })
    ).toMatchObject({
      position: 'fixed',
      note: expect.stringContaining('set_scroll_behavior')
    })
    setScrollBehavior.execute(figma, { id: s.list.id, direction: 'vertical' })
    expect(setScrollPosition.execute(figma, { id: s.items[0].id, position: 'sticky' })).toEqual({
      id: s.items[0].id,
      position: 'sticky'
    })
    setScrollPosition.execute(figma, { id: s.items[0].id, position: 'scrolls' })
    expect(scrollRegions(s.graph, s.screen.id)[0].pinned).toEqual([])
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
      { source: item.id, target: other.id, kind: 'navigate', trigger: 'click', interaction: 0 }
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
