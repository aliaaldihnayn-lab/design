import { describe, expect, test } from 'bun:test'

import { renderNodesToSVG } from '@lawha/core/io/formats/svg'
import { SceneGraph, type Fill } from '@lawha/scene-graph'

const solid = (r: number, g: number, b: number): Fill => ({
  type: 'SOLID',
  color: { r, g, b, a: 1 },
  opacity: 1,
  visible: true
})

/** A frame holding a red panel and a mask over a blue square, as a clip group imports. */
function masked(maskType: 'VECTOR' | 'ALPHA') {
  const graph = new SceneGraph()
  const page = graph.getPages()[0].id
  const frame = graph.createNode('FRAME', page, { width: 200, height: 100 })
  graph.createNode('RECTANGLE', frame.id, { width: 200, height: 100, fills: [solid(1, 0, 0)] })
  const group = graph.createNode('GROUP', frame.id, { name: 'Clip path group' })
  graph.createNode('ELLIPSE', group.id, {
    name: 'Mask',
    x: 20,
    y: 10,
    width: 60,
    height: 60,
    isMask: true,
    maskType,
    fills: [solid(0, 0, 0)]
  })
  graph.createNode('RECTANGLE', group.id, {
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    fills: [solid(0, 0, 1)]
  })
  return renderNodesToSVG(graph, page, [frame.id], { xmlDeclaration: false }) ?? ''
}

describe('SVG export of masks', () => {
  test('an outline mask clips the layers after it and is not drawn itself', () => {
    const svg = masked('VECTOR')
    const clip = /<clipPath id="(mask\d+)">([\s\S]*?)<\/clipPath>/.exec(svg)
    expect(clip?.[2]).toContain('<ellipse')
    expect(clip?.[2]).not.toContain('fill=')
    expect(svg).toContain(`clip-path="url(#${clip?.[1]})"`)
    // The mask's black fill is nowhere drawn.
    expect(svg).not.toContain('fill="#000000"')
  })

  test('an alpha mask becomes an SVG mask', () => {
    const svg = masked('ALPHA')
    const id = /<mask id="(mask\d+)"/.exec(svg)?.[1]
    expect(id).toBeDefined()
    expect(svg).toContain(`mask="url(#${id})"`)
  })
})
