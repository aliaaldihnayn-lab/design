import { describe, expect, test } from 'bun:test'

import { SceneGraph } from '@lawha/scene-graph'

import {
  ease,
  pairChanges,
  rectMapping,
  smartAnimateGraph,
  smartAnimatePlan,
  tweenState
} from '#core/prototype/smart-animate'

/** Two screens where a card grows and moves, a title stays, and a badge only exists on B. */
function screens() {
  const graph = new SceneGraph()
  const page = graph.getPages()[0].id
  const solid = [
    { type: 'SOLID' as const, color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1, visible: true }
  ]
  const a = graph.createNode('FRAME', page, {
    name: 'A',
    x: 0,
    y: 0,
    width: 300,
    height: 600,
    fills: solid
  })
  const b = graph.createNode('FRAME', page, {
    name: 'B',
    x: 400,
    y: 0,
    width: 300,
    height: 600,
    fills: solid
  })
  const cardA = graph.createNode('FRAME', a.id, {
    name: 'Card',
    x: 20,
    y: 100,
    width: 100,
    height: 80,
    fills: solid
  })
  const labelA = graph.createNode('TEXT', cardA.id, {
    name: 'Label',
    x: 8,
    y: 8,
    width: 60,
    height: 20
  })
  const titleA = graph.createNode('TEXT', a.id, {
    name: 'Title',
    x: 20,
    y: 20,
    width: 200,
    height: 30
  })
  const oldA = graph.createNode('RECTANGLE', a.id, {
    name: 'Old',
    x: 0,
    y: 500,
    width: 10,
    height: 10
  })
  const cardB = graph.createNode('FRAME', b.id, {
    name: 'Card',
    x: 0,
    y: 200,
    width: 300,
    height: 240,
    opacity: 0.5,
    fills: solid
  })
  const labelB = graph.createNode('TEXT', cardB.id, {
    name: 'Label',
    x: 24,
    y: 24,
    width: 60,
    height: 20
  })
  const titleB = graph.createNode('TEXT', b.id, {
    name: 'Title',
    x: 20,
    y: 20,
    width: 200,
    height: 30
  })
  const badge = graph.createNode('RECTANGLE', b.id, {
    name: 'Badge',
    x: 250,
    y: 10,
    width: 20,
    height: 20
  })
  return { graph, page, a, b, cardA, labelA, titleA, oldA, cardB, labelB, titleB, badge }
}

describe('smart animate', () => {
  test('matches layers by name and parent names, with positions on their screens', () => {
    const s = screens()
    const plan = smartAnimatePlan(s.graph, s.a.id, s.b.id)
    expect(plan.pairs.map((p) => [p.path, p.from, p.to])).toEqual([
      ['Card', s.cardA.id, s.cardB.id],
      ['Card/Label', s.labelA.id, s.labelB.id],
      ['Title', s.titleA.id, s.titleB.id]
    ])
    const card = plan.pairs[0]
    expect(card.fromState).toMatchObject({ x: 20, y: 100, width: 100, height: 80, opacity: 1 })
    expect(card.toState).toMatchObject({ x: 0, y: 200, width: 300, height: 240, opacity: 0.5 })
    expect(plan.pairs[1].toState).toMatchObject({ x: 24, y: 224 })
    expect(plan.added).toEqual([s.badge.id])
    expect(plan.removed).toEqual([s.oldA.id])
    expect(pairChanges(card)).toBe(true)
    expect(pairChanges(plan.pairs[2])).toBe(false)
  })

  test('siblings sharing a name match in order, and hidden layers do not match', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0].id
    const a = graph.createNode('FRAME', page, { name: 'A', width: 100, height: 100 })
    const b = graph.createNode('FRAME', page, { name: 'B', x: 200, width: 100, height: 100 })
    const a1 = graph.createNode('RECTANGLE', a.id, { name: 'Dot', x: 0 })
    const a2 = graph.createNode('RECTANGLE', a.id, { name: 'Dot', x: 10 })
    graph.createNode('RECTANGLE', a.id, { name: 'Ghost', visible: false })
    const b1 = graph.createNode('RECTANGLE', b.id, { name: 'Dot', x: 50 })
    const b2 = graph.createNode('RECTANGLE', b.id, { name: 'Dot', x: 60 })
    graph.createNode('RECTANGLE', b.id, { name: 'Ghost' })
    const plan = smartAnimatePlan(graph, a.id, b.id)
    expect(plan.pairs.map((p) => [p.from, p.to])).toEqual([
      [a1.id, b1.id],
      [a2.id, b2.id]
    ])
    expect(plan.added).toHaveLength(1)
  })

  test('tweens geometry and opacity along the easing curve', () => {
    const from = { x: 0, y: 0, width: 100, height: 50, opacity: 1, rotation: 0 }
    const to = { x: 100, y: 200, width: 300, height: 50, opacity: 0, rotation: 90 }
    expect(tweenState(from, to, 0, 'linear')).toEqual(from)
    expect(tweenState(from, to, 1, 'linear')).toEqual(to)
    expect(tweenState(from, to, 0.5, 'linear')).toEqual({
      x: 50,
      y: 100,
      width: 200,
      height: 50,
      opacity: 0.5,
      rotation: 45
    })
    // Ease out runs ahead of linear, ease in behind it; the spring overshoots before settling.
    expect(ease('ease-out', 0.5)).toBeGreaterThan(0.5)
    expect(ease('ease-in', 0.5)).toBeLessThan(0.5)
    expect(ease('ease-in-out', 0.5)).toBeCloseTo(0.5, 3)
    const spring = Array.from({ length: 21 }, (_, i) => ease('spring', i / 20))
    expect(Math.max(...spring)).toBeGreaterThan(1)
    expect(spring.at(-1)).toBe(1)
  })

  test('rectMapping carries one box onto another', () => {
    const [sx, sy, tx, ty] = rectMapping(
      { x: 20, y: 100, width: 100, height: 80 },
      { x: 0, y: 200, width: 300, height: 240 }
    )
    const map = (x: number, y: number) => [x * sx + tx, y * sy + ty]
    expect(map(20, 100)).toEqual([0, 200])
    expect(map(120, 180)).toEqual([300, 440])
  })

  test('frame images: the background hides moving layers; a layer image keeps only its branch', () => {
    const s = screens()
    const plan = smartAnimatePlan(s.graph, s.a.id, s.b.id)
    const background = smartAnimateGraph(s.graph, s.a.id, {
      kind: 'background',
      hide: plan.pairs.map((p) => p.from)
    })
    if (!background) throw new Error('no graph')
    expect(background.graph.getNode(s.cardA.id)?.visible).toBe(false)
    expect(background.graph.getNode(s.oldA.id)?.visible).toBe(true)
    expect(s.graph.getNode(s.cardA.id)?.visible).toBe(true)

    const layer = smartAnimateGraph(s.graph, s.a.id, {
      kind: 'layer',
      node: s.cardA.id,
      hide: [s.labelA.id]
    })
    if (!layer) throw new Error('no graph')
    const node = (id: string) => layer.graph.getNode(id)
    expect(node(s.cardA.id)?.visible).toBe(true)
    expect(node(s.cardA.id)?.fills).toHaveLength(1)
    expect(node(s.labelA.id)?.visible).toBe(false)
    expect(node(s.titleA.id)?.visible).toBe(false)
    expect(node(s.oldA.id)?.visible).toBe(false)
    expect(node(s.a.id)?.fills).toEqual([])
    // The document itself is untouched.
    expect(s.graph.getNode(s.a.id)?.fills).toHaveLength(1)
  })
})

test('a layer image ignores hidden ids outside the layer, such as its matched parent', () => {
  const s = screens()
  const layer = smartAnimateGraph(s.graph, s.a.id, {
    kind: 'layer',
    node: s.labelA.id,
    hide: [s.cardA.id, s.titleA.id]
  })
  if (!layer) throw new Error('no graph')
  expect(layer.graph.getNode(s.labelA.id)?.visible).toBe(true)
  expect(layer.graph.getNode(s.cardA.id)?.visible).toBe(true)
  expect(layer.graph.getNode(s.cardA.id)?.fills).toEqual([])
})
