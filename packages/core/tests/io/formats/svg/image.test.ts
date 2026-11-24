import { describe, expect, test } from 'bun:test'

import { expectDefined } from '#core-tests/helpers/assert'
import { fromUint8Array } from 'js-base64'

import { createSVGNodes } from '@lawha/core/io/formats/svg'
import { SceneGraph, type SceneNode } from '@lawha/scene-graph'

/** A 2×1 PNG, so a box of other proportions shows whether the picture is stretched. */
const PNG = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 2, 0, 0, 0, 1, 8, 2, 0, 0,
  0, 123, 64, 232, 221, 0, 0, 0, 15, 73, 68, 65, 84, 120, 156, 99, 248, 207, 192, 192, 192, 240, 31,
  0, 7, 0, 1, 255, 126, 8, 177, 208, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130
])
const HREF = `data:image/png;base64,${fromUint8Array(PNG)}`

function imported(svg: string): { graph: SceneGraph; image: SceneNode } {
  const graph = new SceneGraph()
  const root = expectDefined(createSVGNodes(graph, graph.getPages()[0].id, svg))
  const all = (id: string): SceneNode[] =>
    graph.getChildren(id).flatMap((child) => [child, ...all(child.id)])
  const image = expectDefined(all(root.id).find((node) => node.fills[0]?.type === 'IMAGE'))
  return { graph, image }
}

describe('SVG <image>', () => {
  test('becomes a rectangle filled with its picture, in its place and order', () => {
    const { graph, image } = imported(
      `<svg width="200" height="100" viewBox="0 0 200 100"><rect width="200" height="100" fill="#eee"/>` +
        `<image href="${HREF}" x="10" y="20" width="80" height="40"/><rect x="5" y="5" width="10" height="10"/></svg>`
    )
    expect(image).toMatchObject({ type: 'RECTANGLE', x: 10, y: 20, width: 80, height: 40 })
    const fill = image.fills[0]
    expect(fill.imageScaleMode).toBe('FILL')
    expect(graph.images.get(expectDefined(fill.imageHash))).toEqual(PNG)
    const siblings = expectDefined(graph.getNode(expectDefined(image.parentId))).childIds
    expect(siblings.indexOf(image.id)).toBe(1)
  })

  test('takes the scale of its transform as its size, and stretches without an aspect ratio', () => {
    const { image } = imported(
      `<svg width="400" height="400" viewBox="0 0 400 400">` +
        `<image href="${HREF}" width="1" height="1" preserveAspectRatio="none" transform="matrix(0 120 -300 0 350 50)"/></svg>`
    )
    expect(image.rotation).toBeCloseTo(90, 5)
    expect([image.width, image.height]).toEqual([120, 300])
    expect(image.fills[0].imageScaleMode).toBe('CROP')
    expect(image.fills[0].imageTransform).toEqual({
      m00: 1,
      m01: 0,
      m02: 0,
      m10: 0,
      m11: 1,
      m12: 0
    })
  })

  test('is skipped when it links outside the document', () => {
    const graph = new SceneGraph()
    const root = expectDefined(
      createSVGNodes(
        graph,
        graph.getPages()[0].id,
        '<svg width="10" height="10"><image href="https://example.invalid/a.png" width="10" height="10"/></svg>',
        { keepEmpty: true }
      )
    )
    expect(graph.getChildren(root.id)).toHaveLength(0)
  })
})
