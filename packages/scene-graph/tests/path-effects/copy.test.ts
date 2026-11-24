import { describe, expect, test } from 'bun:test'

import { SceneGraph, type SceneNode } from '@lawha/scene-graph'
import type { LiveBlend } from '@lawha/scene-graph/path-effects'
import { LAWHA_PLUGIN_DATA, readPluginData, withPluginData } from '@lawha/scene-graph/plugin-data'
import {
  applyGraphTransfer,
  prepareGraphTransfer,
  remapCopiedReferences
} from '@lawha/scene-graph/transfer'

/** A live blend group as Core's blend makes it: two ends, a step between them, and a spine. */
function blendGroup(graph: SceneGraph, parentId: string) {
  const group = graph.createNode('GROUP', parentId, { name: 'Blend' })
  const from = graph.createNode('ELLIPSE', group.id, { name: 'From' })
  const step = graph.createNode('VECTOR', group.id, { name: 'Blend 1' })
  const to = graph.createNode('RECTANGLE', group.id, { name: 'To' })
  const spine = graph.createNode('VECTOR', group.id, { name: 'Spine', visible: false })
  const blend: LiveBlend = {
    fromId: from.id,
    toId: to.id,
    spineId: spine.id,
    spacing: 'steps',
    steps: 1,
    distance: 20,
    stepIds: [step.id]
  }
  graph.updateNode(group.id, {
    pluginData: withPluginData(group.pluginData, LAWHA_PLUGIN_DATA.liveBlend, blend)
  })
  return group.id
}

/** The copy's blend, with each id it names read back as the name of the layer it is. */
function blendOf(graph: SceneGraph, group: SceneNode) {
  const blend = readPluginData(group.pluginData, LAWHA_PLUGIN_DATA.liveBlend)
  if (!blend) return null
  const child = (id: string) => {
    const node = graph.getNode(id)
    return node?.parentId === group.id ? node.name : `outside:${id}`
  }
  return {
    from: child(blend.fromId),
    to: child(blend.toId),
    spine: blend.spineId ? child(blend.spineId) : null,
    steps: blend.stepIds.map(child)
  }
}

const NAMED = { from: 'From', to: 'To', spine: 'Spine', steps: ['Blend 1'] }

describe('copying a live blend', () => {
  test('a cloned blend names its own ends, steps, and spine', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0].id
    const original = blendGroup(graph, page)

    const clone = graph.cloneTree(original, page)

    if (!clone) throw new Error('nothing cloned')
    expect(blendOf(graph, clone)).toEqual(NAMED)
    const source = graph.getNode(original)
    if (!source) throw new Error('original gone')
    expect(blendOf(graph, source)).toEqual(NAMED)
  })

  test('a pasted blend names the pasted layers', () => {
    const source = new SceneGraph()
    const group = blendGroup(source, source.getPages()[0].id)
    const target = new SceneGraph()
    const page = target.getPages()[0].id

    const plan = prepareGraphTransfer({
      source,
      rootIds: [group],
      dependencyPageIds: [],
      target,
      parentId: page
    })
    applyGraphTransfer(target, plan)

    const [pasted] = plan.rootIds.flatMap((id) => target.getNode(id) ?? [])
    expect(blendOf(target, pasted)).toEqual(NAMED)
  })

  test('a library copy remaps the blend it holds', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0].id
    const original = blendGroup(graph, page)
    const copy = graph.cloneTree(original, page)
    if (!copy) throw new Error('nothing cloned')
    // A copy made without remapping, as a library materializer writes it, then mapped.
    const stale = graph.getNode(original)?.pluginData ?? []
    graph.updateNode(copy.id, { pluginData: [...stale] })
    const sourceChildren = graph.getNode(original)?.childIds ?? []
    remapCopiedReferences(
      graph,
      new Map([
        [original, copy.id],
        ...sourceChildren.map((id, i): [string, string] => [id, copy.childIds[i]])
      ])
    )

    const remapped = graph.getNode(copy.id)
    if (!remapped) throw new Error('copy gone')
    expect(blendOf(graph, remapped)).toEqual(NAMED)
  })
})
