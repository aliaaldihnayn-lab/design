import { describe, expect, test } from 'bun:test'

import { renderNodesToSVG } from '@lawha/core/io/formats/svg'
import { SceneGraph, type Fill } from '@lawha/scene-graph'

const solid = (r: number, g: number, b: number): Fill => ({
  type: 'SOLID',
  color: { r, g, b, a: 1 },
  opacity: 1,
  visible: true
})

function pattern(sourceNodeId: string, fill: Partial<Fill> = {}): Fill {
  return {
    type: 'PATTERN',
    color: { r: 0, g: 0, b: 0, a: 1 },
    opacity: 1,
    visible: true,
    sourceNodeId,
    scale: 1,
    patternSpacing: { x: 0, y: 0 },
    ...fill
  }
}

/** A 20 px yellow tile holding a red dot, and a layer filled with it. */
function scene(fill: Partial<Fill> = {}) {
  const graph = new SceneGraph()
  const page = graph.getPages()[0].id
  const tile = graph.createNode('COMPONENT', page, {
    name: 'Tile',
    x: 300,
    y: 0,
    width: 20,
    height: 20,
    fills: [solid(1, 1, 0)]
  })
  graph.createNode('ELLIPSE', tile.id, {
    name: 'Dot',
    x: 5,
    y: 5,
    width: 10,
    height: 10,
    fills: [solid(1, 0, 0)]
  })
  const target = graph.createNode('RECTANGLE', page, {
    name: 'Patterned',
    width: 200,
    height: 100,
    fills: [pattern(tile.id, fill)]
  })
  return { graph, page, tile, target }
}

function svgOf(graph: SceneGraph, page: string, ids: string[]) {
  const svg = renderNodesToSVG(graph, page, ids, { xmlDeclaration: false })
  if (!svg) throw new Error('Nothing exported')
  return svg
}

describe('pattern fills exported to SVG', () => {
  test('fill the layer with a pattern of the tile, its children included', () => {
    const { graph, page, target } = scene()
    const svg = svgOf(graph, page, [target.id])

    const id = /<pattern id="([^"]+)" patternUnits="userSpaceOnUse" width="20" height="20"/.exec(
      svg
    )?.[1]
    expect(id).toBeDefined()
    expect(svg).toContain(`fill="url(#${id})"`)
    // The tile draws its own fill and its dot.
    const tile = svg.slice(svg.indexOf('<pattern'), svg.indexOf('</pattern>'))
    expect(tile.toLowerCase()).toContain('#ffff00')
    expect(tile.toLowerCase()).toContain('#ff0000')
  })

  test('moves and turns the tiles about the middle of the layer', () => {
    const { graph, page, target } = scene({
      patternOffset: { x: 4, y: 6 },
      patternRotation: 30
    })
    expect(svgOf(graph, page, [target.id])).toContain(
      'patternTransform="rotate(30, 100, 50) translate(4, 6)"'
    )
  })

  test('a brick tiling repeats every other row, shifted by half a tile', () => {
    const { graph, page, target } = scene({ patternTileType: 'HORIZONTAL_HEXAGONAL' })
    const svg = svgOf(graph, page, [target.id])
    expect(svg).toMatch(/<pattern [^>]*width="20" height="40"/)
    const tile = svg.slice(svg.indexOf('<pattern'), svg.indexOf('</pattern>'))
    // The shifted row's tile crosses the right edge and comes back in on the left.
    for (const at of ['translate(0, 0)', 'translate(10, 20)', 'translate(-10, 20)'])
      expect(tile).toContain(at)
  })

  test('a tile with a layer filled with a pattern of that tile draws it once', () => {
    const { graph, page, tile, target } = scene()
    const [dot] = tile.childIds
    graph.updateNode(dot, { fills: [pattern(tile.id)] })
    const svg = svgOf(graph, page, [target.id])
    // The layer's pattern; inside its tile, the dot's pattern of the tile again is left out.
    expect(svg.match(/<pattern /g)?.length).toBe(1)
  })
})
