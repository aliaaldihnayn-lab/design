import { describe, expect, test } from 'bun:test'

import { exportFigFile, parseFigFile } from '@lawha/core/io/formats/fig'
import { SceneGraph, type SceneNode } from '@lawha/scene-graph'

import { playIslandRoots } from '#core/editor/play/islands'
import { resolvePlayState } from '#core/editor/play/states'
import { getPluginData, setPluginData } from '#core/figma-api/plugin-data'
import { figInteractionsOf } from '#core/prototype/fig'
import { INTERACTIONS_KEY, readInteractions, type Interaction } from '#core/prototype/model'
import {
  ease,
  easedKeyframes,
  springDuration,
  transitionDuration
} from '#core/prototype/smart-animate'
import {
  applyStateChanges,
  dispatchStateEvent,
  dispatchStateKey,
  interactionsOf,
  interactiveLayers,
  isInteractiveComponent,
  stateTimers,
  variantValues
} from '#core/prototype/states'

const DISSOLVE = { type: 'dissolve', direction: 'left', duration: 200, easing: 'ease-out' } as const

function setInteractions(graph: SceneGraph, node: SceneNode, list: Interaction[]) {
  setPluginData(graph, node, INTERACTIONS_KEY, JSON.stringify(list))
}

/**
 * A Dropdown set whose Closed variant opens on click and whose Open variant lists two items
 * that close it; a Button set that shows Hover while hovered; and a screen holding one of each.
 */
function fixture() {
  const graph = new SceneGraph()
  const pageId = graph.getPages()[0]?.id ?? graph.rootId
  const set = graph.createNode('COMPONENT_SET', pageId, {
    name: 'Dropdown',
    width: 400,
    height: 300,
    componentPropertyDefinitions: [
      {
        id: 'state',
        name: 'State',
        type: 'VARIANT',
        defaultValue: 'Closed',
        variantOptions: ['Closed', 'Open']
      }
    ]
  })
  const closed = graph.createNode('COMPONENT', set.id, {
    name: 'State=Closed',
    width: 160,
    height: 40,
    componentPropertyValues: { State: 'Closed' }
  })
  const trigger = graph.createNode('FRAME', closed.id, { name: 'Trigger', width: 160, height: 40 })
  const open = graph.createNode('COMPONENT', set.id, {
    name: 'State=Open',
    y: 60,
    width: 160,
    height: 140,
    componentPropertyValues: { State: 'Open' }
  })
  graph.createNode('FRAME', open.id, { name: 'Trigger', width: 160, height: 40 })
  const menu = graph.createNode('FRAME', open.id, { name: 'Menu', y: 40, width: 160, height: 100 })
  const item = graph.createNode('FRAME', menu.id, { name: 'Item', width: 160, height: 40 })
  setInteractions(graph, trigger, [
    {
      trigger: { type: 'click' },
      action: { type: 'change-to', destination: open.id, transition: DISSOLVE }
    }
  ])
  setInteractions(graph, item, [
    {
      trigger: { type: 'click' },
      action: { type: 'change-to', destination: closed.id, transition: DISSOLVE },
      andThen: [{ type: 'close-overlay' }]
    }
  ])
  setInteractions(graph, open, [
    {
      trigger: { type: 'key', key: 'Escape' },
      action: { type: 'change-to', destination: closed.id, transition: DISSOLVE }
    }
  ])

  const buttons = graph.createNode('COMPONENT_SET', pageId, {
    name: 'Button',
    x: 500,
    width: 300,
    height: 100,
    componentPropertyDefinitions: [
      {
        id: 'look',
        name: 'State',
        type: 'VARIANT',
        defaultValue: 'Default',
        variantOptions: ['Default', 'Hover']
      }
    ]
  })
  const rest = graph.createNode('COMPONENT', buttons.id, {
    name: 'State=Default',
    width: 100,
    height: 40,
    componentPropertyValues: { State: 'Default' }
  })
  const hover = graph.createNode('COMPONENT', buttons.id, {
    name: 'State=Hover',
    x: 120,
    width: 100,
    height: 40,
    componentPropertyValues: { State: 'Hover' }
  })
  setInteractions(graph, rest, [
    {
      trigger: { type: 'hover' },
      action: { type: 'change-to', destination: hover.id, transition: DISSOLVE }
    }
  ])
  setInteractions(graph, hover, [
    {
      trigger: { type: 'after-delay', delay: 500 },
      action: { type: 'change-to', destination: rest.id, transition: DISSOLVE }
    }
  ])

  const screen = graph.createNode('FRAME', pageId, {
    name: 'Screen',
    y: 400,
    width: 390,
    height: 600
  })
  const dropdown = graph.createInstance(closed.id, screen.id, { x: 20, y: 20 })
  const button = graph.createInstance(rest.id, screen.id, { x: 20, y: 300 })
  if (!dropdown || !button) throw new Error('instances not created')
  graph.updateNode(dropdown.id, { name: 'Country' })
  graph.updateNode(button.id, { name: 'Save' })
  return { graph, set, closed, open, rest, hover, screen }
}

/** The screen as it shows with each instance in its state. */
function showing(graph: SceneGraph, screenId: string, states: ReadonlyMap<string, string>) {
  return resolvePlayState(
    graph,
    screenId,
    new Map(
      [...states].map(([path, variant]) => [path, { variants: variantValues(graph, variant) }])
    )
  )
}

describe('interactive components', () => {
  test('a variant layer’s Change to switches the instance holding it, in place', () => {
    const { graph, screen, open, closed } = fixture()
    const now = showing(graph, screen.id, new Map())
    const click = dispatchStateEvent(now, screen.id, 'Country/Trigger', 'click')
    expect(click.handledBy).toBe('Country/Trigger')
    expect(click.changes).toEqual([
      { instance: 'Country', from: closed.id, to: open.id, transition: DISSOLVE }
    ])
    expect(click.holds).toEqual([])

    const states = applyStateChanges(new Map(), click.changes)
    const opened = showing(graph, screen.id, states)
    const item = dispatchStateEvent(opened, screen.id, 'Country/Menu/Item', 'click')
    expect(item.changes.map((change) => change.to)).toEqual([closed.id])
    // Actions after the Change to go to the host.
    expect(item.actions).toEqual([{ type: 'close-overlay' }])
    // The document still draws the instance closed.
    const instance = graph.getChildren(screen.id).find((node) => node.name === 'Country')
    expect(instance?.componentId).toBe(closed.id)
  })

  test('an event bubbles to the nearest layer that answers it, and stops at the root', () => {
    const { graph, screen } = fixture()
    const now = showing(graph, screen.id, new Map())
    expect(dispatchStateEvent(now, screen.id, 'Country/Trigger', 'press').handledBy).toBeNull()
    expect(dispatchStateEvent(now, screen.id, 'Country', 'click').handledBy).toBeNull()
  })

  test('While hovering holds the change until the pointer leaves', () => {
    const { graph, screen, rest, hover } = fixture()
    const now = showing(graph, screen.id, new Map())
    const enter = dispatchStateEvent(now, screen.id, 'Save', 'hover')
    expect(enter.changes.map((change) => change.to)).toEqual([hover.id])
    expect(enter.holds).toEqual([{ instance: 'Save', variant: rest.id, release: 'hover' }])
  })

  test('keys and timers belong to the variants the root shows now', () => {
    const { graph, screen, open, closed, hover } = fixture()
    const closedNow = showing(graph, screen.id, new Map())
    expect(dispatchStateKey(closedNow, screen.id, 'Escape').handledBy).toBeNull()
    const openNow = showing(graph, screen.id, new Map([['Country', open.id]]))
    expect(dispatchStateKey(openNow, screen.id, 'escape').changes.map((c) => c.to)).toEqual([
      closed.id
    ])

    expect(stateTimers(closedNow, screen.id)).toEqual([])
    const hovered = showing(graph, screen.id, new Map([['Save', hover.id]]))
    expect(stateTimers(hovered, screen.id).map((timer) => [timer.path, timer.delay])).toEqual([
      ['Save', 500]
    ])
  })

  test('the layers that answer triggers, and which sets are interactive', () => {
    const { graph, screen, set, rest } = fixture()
    const now = showing(graph, screen.id, new Map())
    const layers = interactiveLayers(now, screen.id)
    expect([...layers.keys()].sort()).toEqual(['Country/Trigger', 'Save'])
    expect(isInteractiveComponent(graph, set)).toBe(true)
    expect(interactionsOf(graph, rest).length).toBe(1)
  })

  test('a change resets the instances nested in it', () => {
    const states = applyStateChanges(
      new Map([
        ['Country', 'a'],
        ['Country/Menu/Item', 'b'],
        ['Countryside', 'c']
      ]),
      [{ instance: 'Country', to: 'd' }]
    )
    expect([...states]).toEqual([
      ['Country', 'd'],
      ['Countryside', 'c']
    ])
  })
})

describe('transition timing', () => {
  test('a custom spring settles at its end and lasts as its physics say', () => {
    const stiff = { stiffness: 600, damping: 30, mass: 1 }
    const loose = { stiffness: 100, damping: 8, mass: 1 }
    expect(springDuration(stiff)).toBeLessThan(springDuration(loose))
    const transition = {
      type: 'smart-animate',
      direction: 'left',
      duration: 300,
      easing: 'custom-spring',
      spring: loose
    } as const
    expect(transitionDuration(transition)).toBe(springDuration(loose))
    const frames = easedKeyframes(transition, 40)
    expect(frames[0]).toEqual({ offset: 0, progress: 0 })
    expect(frames.at(-1)).toEqual({ offset: 1, progress: 1 })
    // An under-damped spring overshoots before it settles.
    expect(Math.max(...frames.map((frame) => frame.progress))).toBeGreaterThan(1)
  })

  test('back easings overshoot; instant takes no time', () => {
    expect(ease('ease-out-back', 0.6)).toBeGreaterThan(1)
    expect(ease('ease-in-back', 0.2)).toBeLessThan(0)
    expect(
      transitionDuration({ type: 'instant', direction: 'left', duration: 300, easing: 'linear' })
    ).toBe(0)
  })
})

describe('.fig interactive components', () => {
  test('Change to and its transition round-trip as Figma’s own interactions', async () => {
    const { graph, set } = fixture()
    const bytes = await exportFigFile(graph)
    const read = await parseFigFile(bytes.buffer as ArrayBuffer)
    const byName = (name: string, parent?: string) =>
      [...read.getAllNodes()].find(
        (node) =>
          node.name === name && (!parent || read.getNode(node.parentId ?? '')?.name === parent)
      )
    const trigger = byName('Trigger', 'State=Closed')
    const open = byName('State=Open', set.name)
    const closed = byName('State=Closed', set.name)
    const item = byName('Item')
    if (!trigger || !open || !closed || !item) throw new Error('layers missing after reading back')
    // Figma's own record, read without Lawha's plugin data, says the same thing.
    expect(trigger.source.fig.rawNodeFields.prototypeInteractions).toBeDefined()
    expect(figInteractionsOf(read, trigger)).toEqual([
      {
        trigger: { type: 'click' },
        action: { type: 'change-to', destination: open.id, transition: DISSOLVE }
      }
    ])
    expect(figInteractionsOf(read, item)).toEqual([
      {
        trigger: { type: 'click' },
        action: { type: 'change-to', destination: closed.id, transition: DISSOLVE },
        andThen: [{ type: 'close-overlay' }]
      }
    ])
    expect(figInteractionsOf(read, open)).toEqual([
      {
        trigger: { type: 'key', key: 'Escape' },
        action: { type: 'change-to', destination: closed.id, transition: DISSOLVE }
      }
    ])
    // Lawha's own plugin data still wins where it is kept.
    expect(getPluginData(trigger, INTERACTIONS_KEY)).not.toBe('')
    expect(readInteractions(trigger, read)[0]?.action.type).toBe('change-to')
  })

  test('a spring and a slide keep their settings through .fig', async () => {
    const graph = new SceneGraph()
    const pageId = graph.getPages()[0]?.id ?? graph.rootId
    const a = graph.createNode('FRAME', pageId, { name: 'A', width: 100, height: 100 })
    const b = graph.createNode('FRAME', pageId, { name: 'B', x: 200, width: 100, height: 100 })
    const transition = {
      type: 'slide-in',
      direction: 'up',
      duration: 450,
      easing: 'custom-spring',
      spring: { stiffness: 250, damping: 12, mass: 2 }
    } as const
    setInteractions(graph, a, [
      {
        trigger: { type: 'mouse-enter', delay: 300 },
        action: { type: 'navigate', destination: b.id, transition }
      },
      // Figma has no focus trigger: it stays Lawha's alone.
      { trigger: { type: 'focus' }, action: { type: 'back' } }
    ])
    const read = await parseFigFile((await exportFigFile(graph)).buffer as ArrayBuffer)
    const readA = [...read.getAllNodes()].find((node) => node.name === 'A')
    const readB = [...read.getAllNodes()].find((node) => node.name === 'B')
    if (!readA || !readB) throw new Error('frames missing')
    expect(figInteractionsOf(read, readA)).toEqual([
      {
        trigger: { type: 'mouse-enter', delay: 300 },
        action: { type: 'navigate', destination: readB.id, transition }
      }
    ])
    expect(readInteractions(readA, read)).toHaveLength(2)
  })
})

describe('live islands', () => {
  test('a screen holding interactive components runs as an island; the sets do not', () => {
    const { graph, screen } = fixture()
    const pageId = graph.getPages()[0]?.id ?? graph.rootId
    expect(playIslandRoots(graph, pageId)).toEqual([screen.id])
  })
})
