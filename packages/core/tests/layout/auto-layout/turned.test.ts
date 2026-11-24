import { describe, expect, test } from 'bun:test'

import { computeAllLayouts } from '@lawha/core/layout'
import { SceneGraph, type SceneNode } from '@lawha/scene-graph'
import { getNodeWorldBounds } from '@lawha/scene-graph/coordinate'

function hugRow(graph: SceneGraph, overrides: Partial<SceneNode> = {}, parentId?: string) {
  return graph.createNode('FRAME', parentId ?? graph.getPages()[0].id, {
    layoutMode: 'HORIZONTAL',
    primaryAxisSizing: 'HUG',
    counterAxisSizing: 'HUG',
    itemSpacing: 10,
    paddingLeft: 16,
    paddingRight: 16,
    paddingTop: 12,
    paddingBottom: 12,
    width: 100,
    height: 100,
    ...overrides
  })
}

function drawn(graph: SceneGraph, id: string) {
  const node = graph.getNode(id)
  if (!node) throw new Error(`missing ${id}`)
  const box = getNodeWorldBounds(node)
  return { left: box.x, top: box.y, right: box.x + box.width, bottom: box.y + box.height }
}

// Figma lays a turned layer out by its bounding box: a 100 by 60 layer turned 20° takes
// 100 cos 20° + 60 sin 20° = 114.49 across and 100 sin 20° + 60 cos 20° = 90.58 down.
const TURNED_WIDTH = 114.49
const TURNED_HEIGHT = 90.58

describe('turned layers in auto layout', () => {
  for (const rotation of [20, -340]) {
    test(`take their bounding box's place, and the frame hugs it (rotation ${rotation})`, () => {
      const graph = new SceneGraph()
      const frame = hugRow(graph)
      const turned = graph.createNode('RECTANGLE', frame.id, { width: 100, height: 60, rotation })
      const square = graph.createNode('RECTANGLE', frame.id, { width: 80, height: 80 })
      computeAllLayouts(graph)

      const box = drawn(graph, turned.id)
      expect(box.left).toBeCloseTo(16, 3)
      expect(box.top).toBeCloseTo(12, 3)
      expect(box.right - box.left).toBeCloseTo(TURNED_WIDTH, 2)
      expect(box.bottom - box.top).toBeCloseTo(TURNED_HEIGHT, 2)
      expect(graph.getNode(turned.id)).toMatchObject({ width: 100, height: 60 })
      // The next layer starts past the turned layer's box, not its unturned width.
      expect(drawn(graph, square.id).left).toBeCloseTo(box.right + 10, 3)
      expect(graph.getNode(frame.id)?.width).toBeCloseTo(16 + TURNED_WIDTH + 10 + 80 + 16, 2)
      expect(graph.getNode(frame.id)?.height).toBeCloseTo(12 + TURNED_HEIGHT + 12, 2)
    })
  }

  test('a column centres a turned layer by its box', () => {
    const graph = new SceneGraph()
    const frame = hugRow(graph, {
      layoutMode: 'VERTICAL',
      counterAxisAlign: 'CENTER',
      counterAxisSizing: 'FIXED',
      width: 300
    })
    const turned = graph.createNode('RECTANGLE', frame.id, {
      width: 100,
      height: 60,
      rotation: 20
    })
    const below = graph.createNode('RECTANGLE', frame.id, { width: 40, height: 40 })
    computeAllLayouts(graph)

    const box = drawn(graph, turned.id)
    expect((box.left + box.right) / 2).toBeCloseTo(150, 3)
    expect(box.top).toBeCloseTo(12, 3)
    expect(drawn(graph, below.id).top).toBeCloseTo(box.bottom + 10, 3)
  })

  test('a turned auto layout frame inside one lays out its own layers', () => {
    const graph = new SceneGraph()
    const outer = hugRow(graph)
    const inner = hugRow(graph, { rotation: 90 }, outer.id)
    const child = graph.createNode('RECTANGLE', inner.id, { width: 50, height: 20 })
    computeAllLayouts(graph)

    expect(graph.getNode(inner.id)).toMatchObject({ width: 82, height: 44 })
    expect(graph.getNode(child.id)).toMatchObject({ x: 16, y: 12 })
    const box = drawn(graph, inner.id)
    expect(box.left).toBeCloseTo(16, 3)
    expect(box.right - box.left).toBeCloseTo(44, 3)
    expect(graph.getNode(outer.id)).toMatchObject({ width: 76, height: 106 })
  })
})
