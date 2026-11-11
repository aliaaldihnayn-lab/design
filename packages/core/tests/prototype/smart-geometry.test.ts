import { describe, expect, test } from 'bun:test'

import { SceneGraph } from '@lawha/scene-graph'

import { clickOutside, fire, start } from '#core/prototype/engine'
import { smartAnimatePlan } from '#core/prototype/smart-animate'
import { geometryKeyframe, overlayOrigin } from '#core/prototype/smart-geometry'

const solid = (r: number, g: number, b: number) => [
  { type: 'SOLID' as const, color: { r, g, b, a: 1 }, opacity: 1, visible: true }
]

/** Two screens with a card that grows, keeps 16px corners and a 2px inside stroke. */
function screens() {
  const graph = new SceneGraph()
  const page = graph.getPages()[0].id
  const a = graph.createNode('FRAME', page, { name: 'A', width: 400, height: 800 })
  const b = graph.createNode('FRAME', page, { name: 'B', x: 600, width: 400, height: 800 })
  const card = (parent: string, x: number, y: number, width: number, height: number) =>
    graph.createNode('RECTANGLE', parent, {
      name: 'Card',
      x,
      y,
      width,
      height,
      cornerRadius: 16,
      fills: solid(1, 0, 0),
      strokes: [{ ...solid(0, 0, 0)[0], weight: 2, align: 'INSIDE' as const }]
    })
  const from = card(a.id, 20, 40, 100, 60)
  const to = card(b.id, 0, 300, 400, 200)
  return { graph, page, a, b, from, to }
}

describe('Smart Animate by geometry', () => {
  test('a box tweens its own size, corners and stroke instead of a stretched image', () => {
    const s = screens()
    const [pair] = smartAnimatePlan(s.graph, s.a.id, s.b.id).pairs
    expect(pair.geometry?.from).toMatchObject({ x: 20, y: 40, width: 100, height: 60 })
    expect(pair.geometry?.to).toMatchObject({ x: 0, y: 300, width: 400, height: 200 })
    expect(pair.geometry?.to.radii).toEqual([16, 16, 16, 16])
    expect(pair.geometry?.to.stroke).toEqual({ weight: 2, color: 'rgb(0, 0, 0)', align: 'inside' })
    if (!pair.geometry) throw new Error('expected geometry')
    const start = geometryKeyframe(pair.geometry.from, 2)
    const end = geometryKeyframe(pair.geometry.to, 2)
    // At twice the size the corners are 32px at both ends: they are not scaled with the box.
    expect(start.borderRadius).toBe('32px 32px 32px 32px')
    expect(end.borderRadius).toBe('32px 32px 32px 32px')
    expect(start.boxShadow).toBe(end.boxShadow)
    expect(start.boxShadow).toContain('inset 0px 0px 0px 4px rgb(0, 0, 0)')
    expect(end).toMatchObject({ left: '0px', top: '600px', width: '800px', height: '400px' })
  })

  test('layers CSS cannot draw keep their images', () => {
    const s = screens()
    s.graph.updateNode(s.to.id, {
      fills: [
        {
          type: 'GRADIENT_LINEAR',
          color: { r: 0, g: 0, b: 0, a: 1 },
          opacity: 1,
          visible: true,
          gradientStops: [{ color: { r: 1, g: 0, b: 0, a: 1 }, position: 0 }]
        }
      ]
    })
    expect(smartAnimatePlan(s.graph, s.a.id, s.b.id).pairs[0].geometry).toBeNull()
    const t = screens()
    t.graph.createNode('TEXT', t.from.id, { name: 'Label', text: 'Hi' })
    // A rectangle has no children; a frame whose child is not matched keeps its image.
    const frame = t.graph.createNode('FRAME', t.a.id, { name: 'Box', width: 50, height: 50 })
    t.graph.createNode('FRAME', t.b.id, { name: 'Box', width: 80, height: 80 })
    t.graph.createNode('TEXT', frame.id, { name: 'Only here', text: 'x' })
    const box = smartAnimatePlan(t.graph, t.a.id, t.b.id).pairs.find((p) => p.from === frame.id)
    expect(box?.geometry).toBeNull()
  })

  test('shadows pad to the same count so the browser tweens them pairwise', () => {
    const s = screens()
    s.graph.updateNode(s.to.id, {
      effects: [
        {
          type: 'DROP_SHADOW',
          color: { r: 0, g: 0, b: 0, a: 0.5 },
          offset: { x: 0, y: 8 },
          radius: 24,
          spread: 0,
          visible: true
        }
      ]
    })
    const [pair] = smartAnimatePlan(s.graph, s.a.id, s.b.id).pairs
    if (!pair.geometry) throw new Error('expected geometry')
    const from = geometryKeyframe(pair.geometry.from, 1, 1)
    const to = geometryKeyframe(pair.geometry.to, 1, 1)
    expect(from.boxShadow.split('), ').length).toBe(to.boxShadow.split('), ').length)
    expect(to.boxShadow).toContain('0px 8px 24px 0px rgba(0, 0, 0, 0.5)')
  })
})

describe('overlays with Smart Animate', () => {
  test('an overlay is placed as Figma places it, and its layers are measured from there', () => {
    const screen = { width: 400, height: 800 }
    const sheet = { width: 400, height: 300 }
    expect(overlayOrigin(screen, sheet, 'bottom')).toEqual({ x: 0, y: 500 })
    expect(overlayOrigin(screen, sheet, 'center')).toEqual({ x: 0, y: 250 })
    expect(overlayOrigin(screen, { width: 200, height: 100 }, 'right')).toEqual({ x: 200, y: 350 })
    const s = screens()
    const [pair] = smartAnimatePlan(s.graph, s.a.id, s.b.id, { x: 0, y: 500 }).pairs
    expect(pair.toState).toMatchObject({ x: 0, y: 800 })
  })

  test('a Smart Animate overlay closes with Smart Animate; others close at once', () => {
    const s = screens()
    const smart = {
      type: 'smart-animate' as const,
      direction: 'left' as const,
      duration: 300,
      easing: 'ease-out' as const
    }
    const opened = fire(s.graph, start(s.a.id), {
      type: 'overlay',
      destination: s.b.id,
      position: 'bottom',
      closeOnOutside: true,
      transition: smart
    })
    expect(opened?.transition?.type).toBe('smart-animate')
    if (!opened) throw new Error('expected a step')
    expect(fire(s.graph, opened.state, { type: 'close-overlay' })?.transition).toEqual(smart)
    expect(clickOutside(opened.state)?.transition).toEqual(smart)
    const plain = fire(s.graph, start(s.a.id), {
      type: 'overlay',
      destination: s.b.id,
      position: 'center',
      closeOnOutside: true,
      transition: { ...smart, type: 'dissolve' }
    })
    if (!plain) throw new Error('expected a step')
    expect(fire(s.graph, plain.state, { type: 'close-overlay' })?.transition).toBeNull()
  })
})
