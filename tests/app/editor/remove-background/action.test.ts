import { afterEach, describe, expect, test } from 'bun:test'

import { SceneGraph, type Fill } from '@lawha/scene-graph'
import { LAWHA_PLUGIN_DATA, withPluginData } from '@lawha/scene-graph/plugin-data'

import { removeBackgroundFromSelection } from '@/app/editor/remove-background'
import { createEditorStore } from '@/app/editor/session'

const stores: ReturnType<typeof createEditorStore>[] = []
afterEach(() => {
  for (const store of stores.splice(0)) store.dispose()
})

function imageFill(imageHash: string): Fill {
  return {
    type: 'IMAGE',
    imageHash,
    imageScaleMode: 'FILL',
    color: { r: 0, g: 0, b: 0, a: 1 },
    opacity: 1,
    visible: true
  }
}

describe('remove background', () => {
  test('cuts out the photo under a paint layer, not the paint', async () => {
    const graph = new SceneGraph()
    const store = createEditorStore(graph)
    stores.push(store)
    const photo = store.storeImage(new Uint8Array([1, 2, 3]))
    const paint = store.storeImage(new Uint8Array([4, 5, 6]))
    const node = graph.createNode('RECTANGLE', graph.getPages()[0].id, {
      width: 40,
      height: 20,
      fills: [imageFill(photo), imageFill(paint)],
      pluginData: withPluginData([], LAWHA_PLUGIN_DATA.paintLayer, {
        hash: paint,
        density: 1,
        resample: 'nearest'
      })
    })
    store.select([node.id])
    const sent: Uint8Array[] = []
    await removeBackgroundFromSelection(store, async (bytes) => {
      sent.push(bytes)
      return new Uint8Array([7, 8, 9])
    })
    expect(sent).toEqual([new Uint8Array([1, 2, 3])])
    const fills = graph.getNode(node.id)?.fills ?? []
    expect(fills[1]?.imageHash).toBe(paint)
    expect(fills[0]?.imageHash).not.toBe(photo)
  })
})
