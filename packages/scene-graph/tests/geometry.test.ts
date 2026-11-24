import { describe, expect, test } from 'bun:test'

import { SceneGraph } from '@lawha/scene-graph'
import { computeGraphVisualBounds, getAxisAlignedWorldBounds } from '@lawha/scene-graph/coordinate'
import { nodeVisualBounds, type VisualBoundsNode } from '@lawha/scene-graph/geometry'

const at = () => ({ x: 10, y: 20 })

function text(props: Partial<VisualBoundsNode>): VisualBoundsNode {
  return { id: 'text', type: 'TEXT', visible: true, width: 110, height: 40, ...props }
}

// Figma 126 draws a fixed-size text's lines past its box.
describe('text lines past a fixed-size box', () => {
  test('reach the visual bounds', () => {
    expect(nodeVisualBounds(text({ derivedTextHeight: 154 }), at)).toEqual({
      minX: 10,
      minY: 20,
      maxX: 120,
      maxY: 174
    })
  })

  test('turn with the text', () => {
    const bounds = nodeVisualBounds(text({ derivedTextHeight: 154, rotation: 90 }), at)
    expect(bounds.maxX - bounds.minX).toBeCloseTo(154)
    expect(bounds.maxY - bounds.minY).toBeCloseTo(110)
  })

  test('within the box leave it as it is', () => {
    expect(nodeVisualBounds(text({ derivedTextHeight: 30 }), at).maxY).toBe(60)
  })
})

describe('visual bounds of turned layers', () => {
  test('bound a turned layer, and one inside a turned frame, where they are drawn', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0].id
    const turned = graph.createNode('RECTANGLE', page, {
      x: 400,
      y: 0,
      width: 100,
      height: 50,
      rotation: 30
    })
    const frame = graph.createNode('FRAME', page, {
      x: 0,
      y: 200,
      width: 200,
      height: 100,
      rotation: 45
    })
    const child = graph.createNode('RECTANGLE', frame.id, { x: 10, y: 10, width: 50, height: 20 })
    for (const node of [turned, frame, child]) {
      const world = getAxisAlignedWorldBounds(node, graph)
      const bounds = computeGraphVisualBounds(graph, [node.id])
      expect(bounds?.minX).toBeCloseTo(world.x)
      expect(bounds?.minY).toBeCloseTo(world.y)
      expect(bounds?.maxX).toBeCloseTo(world.x + world.width)
      expect(bounds?.maxY).toBeCloseTo(world.y + world.height)
    }
  })
})
