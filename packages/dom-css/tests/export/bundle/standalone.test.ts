import { describe, expect, test } from 'bun:test'

import { exportHTMLBundle } from '#dom-css/export/bundle'
import { sceneNodeToDesignDocument } from '#dom-css/export/projection'

import { SceneGraph } from '@lawha/scene-graph'

/** Each class rule of a page's stylesheet, by the text of the layer it styles. */
function rules(html: string): string[] {
  return [...html.matchAll(/\.op-[0-9a-z]+\{([^}]*)\}/g)].map((match) => match[1] ?? '')
}

describe('standalone HTML', () => {
  test('places the top layer on the stage and leaves its auto layout children to flex', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0].id
    const row = graph.createNode('FRAME', page, {
      name: 'Row',
      x: 40,
      y: 30,
      width: 200,
      height: 40,
      layoutMode: 'HORIZONTAL',
      itemSpacing: 8
    })
    for (const name of ['A', 'B']) {
      graph.createNode('RECTANGLE', row.id, { name, x: 0, y: 0, width: 20, height: 20 })
    }
    const document = sceneNodeToDesignDocument(graph, row.id, { includeSourceIds: false })
    const bundle = await exportHTMLBundle(document, { html: 'standalone' })
    const css = rules(String(bundle.files[0]?.content))

    const placed = css.filter((rule) => rule.includes('position: absolute'))
    expect(placed).toHaveLength(1)
    expect(placed[0]).toContain('display: flex')
    expect(placed[0]).toContain('left: 0px')
  })
})
