import { afterEach, describe, expect, test } from 'bun:test'

import { expectDefined } from '#core-tests/helpers/assert'

import { createEditor, type Editor } from '@lawha/core'
import { buildLawhaClipboardHTML } from '@lawha/core/clipboard'
import type { LiveBlend } from '@lawha/scene-graph/path-effects'
import { LAWHA_PLUGIN_DATA, readPluginData, withPluginData } from '@lawha/scene-graph/plugin-data'

let editor: Editor

afterEach(() => editor.dispose())

/** A live blend group of two ends and a step, as Core's blend makes it. */
function blendGroup() {
  editor = createEditor()
  const page = editor.state.currentPageId
  const group = editor.graph.createNode('GROUP', page, { name: 'Blend', x: 300 })
  const from = editor.graph.createNode('ELLIPSE', group.id, { name: 'From', width: 10, height: 10 })
  const step = editor.graph.createNode('VECTOR', group.id, { name: 'Step', x: 20 })
  const to = editor.graph.createNode('RECTANGLE', group.id, { name: 'To', x: 40, width: 10 })
  const blend: LiveBlend = {
    fromId: from.id,
    toId: to.id,
    spacing: 'steps',
    steps: 1,
    distance: 20,
    stepIds: [step.id]
  }
  editor.graph.updateNode(group.id, {
    pluginData: withPluginData([], LAWHA_PLUGIN_DATA.liveBlend, blend)
  })
  return expectDefined(editor.graph.getNode(group.id))
}

/** The names of the layers a group's blend names, or where they are not its children. */
function blendNames(id: string) {
  const group = expectDefined(editor.graph.getNode(id))
  const blend = expectDefined(readPluginData(group.pluginData, LAWHA_PLUGIN_DATA.liveBlend))
  const name = (child: string) => {
    const node = editor.graph.getNode(child)
    return node?.parentId === id ? node.name : 'elsewhere'
  }
  return [blend.fromId, ...blend.stepIds, blend.toId].map(name)
}

describe('a pasted live blend', () => {
  test('steps between its own pasted ends', async () => {
    const group = blendGroup()
    await editor.pasteFromHTML(buildLawhaClipboardHTML([group], editor.graph))
    const [pasted] = editor.state.selectedIds
    expect(pasted).not.toBe(group.id)
    expect(blendNames(pasted)).toEqual(['From', 'Step', 'To'])
    expect(blendNames(group.id)).toEqual(['From', 'Step', 'To'])
  })

  test('a duplicate does too', () => {
    const group = blendGroup()
    editor.select([group.id])
    editor.duplicateSelected()
    const [copy] = editor.state.selectedIds
    expect(copy).not.toBe(group.id)
    expect(blendNames(copy)).toEqual(['From', 'Step', 'To'])
  })
})
