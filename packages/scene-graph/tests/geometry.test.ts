import { describe, expect, test } from 'bun:test'

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

// A turned or reflected layer's absolute position is where its own origin lands, its turned
// corner, as `getAbsolutePosition` gives it; its visual bounds still cover its whole box.
describe('turned and reflected layers', () => {
  const box = (props: Partial<VisualBoundsNode>): VisualBoundsNode => ({
    id: 'box',
    type: 'RECTANGLE',
    visible: true,
    width: 50,
    height: 20,
    ...props
  })

  test('cover the box turned about its centre', () => {
    // A 50 × 20 box at (120, 30) turned 30°: its origin lands at (128.35, 18.84).
    const origin = () => ({ x: 128.349_364_905_389, y: 18.839_745_962_155_6 })
    const bounds = nodeVisualBounds(box({ rotation: 30 }), origin)
    expect(bounds.minX).toBeCloseTo(118.35, 2)
    expect(bounds.maxX).toBeCloseTo(171.65, 2)
    expect(bounds.minY).toBeCloseTo(18.84, 2)
    expect(bounds.maxY).toBeCloseTo(61.16, 2)
  })

  test('cover the box reflected about its centre', () => {
    // Reflected across, the box's origin lands at its right edge.
    const bounds = nodeVisualBounds(box({ flipX: true }), () => ({ x: 170, y: 30 }))
    expect(bounds).toEqual({ minX: 120, minY: 30, maxX: 170, maxY: 50 })
  })
})
