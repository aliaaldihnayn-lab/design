import { describe, expect, test } from 'bun:test'

import { SceneGraph } from '@lawha/scene-graph'

import { formatPageNumber, publicationPages } from '#core/publisher/pages'

describe('publication pages', () => {
  test('are the canvas frames in reading order, rows from the top', () => {
    const graph = new SceneGraph()
    const canvas = graph.getPages()[0].id
    const frame = (name: string, x: number, y: number) =>
      graph.createNode('FRAME', canvas, { name, x, y, width: 100, height: 140 })
    frame('3', 0, 300)
    frame('2', 200, 4)
    frame('1', 0, 0)
    frame('4', 200, 300)
    graph.createNode('COMPONENT', canvas, {
      name: 'Master',
      x: -400,
      y: 0,
      width: 100,
      height: 140
    })
    expect(publicationPages(graph, canvas).map((page) => page.name)).toEqual(['1', '2', '3', '4'])
  })

  test('page number templates', () => {
    expect(formatPageNumber('Page {page} of {pages}', 3, 12)).toBe('Page 3 of 12')
    expect(formatPageNumber('{page}', null, 12)).toBe('#')
  })
})
