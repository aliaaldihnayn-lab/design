import { beforeAll, expect, test } from 'bun:test'

import { exportFigFile, parseFigFile } from '@lawha/core/io/formats/fig'
import { initCodec } from '@lawha/kiwi/fig/codec'
import { SceneGraph } from '@lawha/scene-graph'
import { LAWHA_PLUGIN_DATA, withPluginData } from '@lawha/scene-graph/plugin-data'

import { publicationPages, publicationSettings } from '#core/publisher'

beforeAll(async () => {
  await initCodec()
})

async function reopen(graph: SceneGraph) {
  return parseFigFile((await exportFigFile(graph)).slice().buffer)
}

test('a publication keeps its numbering, direction and spreads when saved and reopened', async () => {
  const graph = new SceneGraph()
  const canvas = graph.getPages()[0]
  for (const x of [0, 400]) {
    graph.createNode('FRAME', canvas.id, { name: `Page ${x}`, x, y: 0, width: 300, height: 400 })
  }
  const settings = {
    numberStart: 5,
    numberFormat: 'arabic-indic',
    direction: 'rtl',
    spreads: true
  } as const
  graph.updateNode(canvas.id, {
    pluginData: withPluginData(canvas.pluginData, LAWHA_PLUGIN_DATA.publication, settings)
  })

  const reopened = await reopen(graph)
  const page = reopened.getPages()[0]
  expect(publicationSettings(reopened, page.id)).toEqual(settings)
  expect(publicationPages(reopened, page.id)).toHaveLength(2)

  // Saving the reopened file again keeps them too.
  const again = await reopen(reopened)
  expect(publicationSettings(again, again.getPages()[0].id)).toEqual(settings)
})
