import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { ALL_TOOLS, toolChangesDocument } from '@lawha/core/tools'
import { SceneGraph } from '@lawha/scene-graph'
import { colorToFill } from '@lawha/scene-graph/color'

import { runEditorTool } from '@/app/ai/tools/runner'
import { makeFigmaFromStore } from '@/app/automation/bridge/figma-factory'
import { createEditorStore, type EditorStore } from '@/app/editor/session/create'

import { expectDefined } from '#tests/helpers/assert'

/** The layers each call starts from. */
interface Layers {
  page: string
  frame: string
  rect: string
  rect2: string
  text: string
  collection: string
  variable: string
}

/** One call per kind of edit an agent makes, with arguments a model would send. */
const CALLS: Array<[string, (layers: Layers) => Record<string, unknown>]> = [
  [
    'render',
    ({ frame }) => ({
      jsx: '<Frame name="Card" w={160} h={80} bg="#FFFFFF"><Text>مرحبا بالعالم</Text></Frame>',
      parent_id: frame
    })
  ],
  ['create_shape', () => ({ type: 'ELLIPSE', x: 400, y: 0, width: 40, height: 40 })],
  ['update_node', ({ rect }) => ({ id: rect, x: 30, width: 70, name: 'Moved' })],
  ['set_fill', ({ rect }) => ({ id: rect, color: '#2563EB' })],
  ['set_stroke', ({ rect }) => ({ id: rect, color: '#111111', weight: 2 })],
  ['set_radius', ({ rect }) => ({ id: rect, radius: 8 })],
  ['set_layout', ({ frame }) => ({ id: frame, direction: 'HORIZONTAL', spacing: 12 })],
  ['set_text', ({ text }) => ({ id: text, text: 'نص جديد' })],
  ['set_effects', ({ rect }) => ({ id: rect, type: 'DROP_SHADOW', radius: 4 })],
  ['set_opacity', ({ rect }) => ({ id: rect, value: 0.5 })],
  ['set_rotation', ({ rect }) => ({ id: rect, angle: 30 })],
  ['node_resize', ({ rect }) => ({ id: rect, width: 90, height: 30 })],
  ['node_move', ({ rect }) => ({ id: rect, x: 120, y: 120 })],
  ['rename_node', ({ rect }) => ({ id: rect, name: 'زر' })],
  ['clone_node', ({ rect }) => ({ id: rect })],
  ['delete_node', ({ rect }) => ({ id: rect })],
  ['reparent_node', ({ text, page }) => ({ id: text, parent_id: page })],
  ['group_nodes', ({ rect, rect2 }) => ({ ids: [rect, rect2] })],
  ['boolean_union', ({ rect, rect2 }) => ({ ids: [rect, rect2] })],
  ['flatten_nodes', ({ rect, rect2 }) => ({ ids: [rect, rect2] })],
  ['create_component', ({ rect }) => ({ id: rect })],
  ['create_page', () => ({ name: 'صفحة' })],
  [
    'import_svg',
    () => ({
      svg: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>'
    })
  ],
  [
    'batch_update',
    ({ rect, rect2 }) => ({
      operations: JSON.stringify([
        { id: rect, props: { name: 'A' } },
        { id: rect2, props: { visible: false } }
      ])
    })
  ],
  ['arrange', ({ rect, rect2 }) => ({ ids: [rect, rect2] })],
  ['create_collection', () => ({ name: 'Brand' })],
  [
    'create_variable',
    ({ collection }) => ({
      name: 'Accent',
      type: 'COLOR',
      collection_id: collection,
      value: '#FF0000'
    })
  ],
  [
    'bind_variable',
    ({ rect, variable }) => ({ node_id: rect, field: 'fills/0/color', variable_id: variable })
  ],
  ['add_user_story', ({ frame }) => ({ node: frame, title: 'تسجيل الدخول' })],
  ['eval', () => ({ code: 'const r = figma.createRectangle(); r.name = "From eval"; return r.id' })]
]

let store: EditorStore

beforeEach(() => {
  // The automation FigmaAPI reads the viewport size from the window.
  Object.assign(globalThis, { window: { innerWidth: 1024, innerHeight: 768 } })
  store = createEditorStore(new SceneGraph())
})

afterEach(() => {
  store.dispose()
  Reflect.deleteProperty(globalThis, 'window')
})

function setUpLayers(): Layers {
  const graph = store.graph
  const pageId = store.state.currentPageId
  const frame = graph.createNode('FRAME', pageId, { name: 'Screen', width: 300, height: 300 })
  const rect = graph.createNode('RECTANGLE', frame.id, {
    x: 10,
    y: 10,
    width: 50,
    height: 50,
    fills: [colorToFill('#D9D9D9')]
  })
  const rect2 = graph.createNode('RECTANGLE', frame.id, { x: 40, y: 40, width: 50, height: 50 })
  const text = graph.createNode('TEXT', frame.id, { y: 120, width: 100, height: 20, text: 'مرحبا' })
  const collection = graph.createCollection('Colors')
  const variable = graph.createVariable('Primary', 'COLOR', collection.id, {
    r: 0,
    g: 0,
    b: 1,
    a: 1
  })
  return {
    page: pageId,
    frame: frame.id,
    rect: rect.id,
    rect2: rect2.id,
    text: text.id,
    collection: collection.id,
    variable: variable.id
  }
}

/** The document as undo must restore it: every page's layers and every variable. */
function documentState(): string {
  const graph = store.graph
  const nodes = [...graph.nodes.values()].map(({ source: _source, ...node }) => node)
  return JSON.stringify({
    nodes: nodes.toSorted((a, b) => a.id.localeCompare(b.id)),
    variables: [...graph.variables.values()],
    collections: [...graph.variableCollections.values()]
  })
}

describe.each(CALLS)('%s', (name, argumentsFor) => {
  test('is one undo step that undo takes back and redo puts back', async () => {
    const def = expectDefined(
      ALL_TOOLS.find((tool) => tool.name === name),
      name
    )
    expect(toolChangesDocument(def)).toBe(true)
    const layers = setUpLayers()
    const figma = makeFigmaFromStore(store, store.state.currentPageId)
    const before = documentState()
    const depth = store.undo.undoDepth

    const result = await runEditorTool({
      store,
      figma,
      def,
      args: argumentsFor(layers),
      source: 'MCP'
    })
    expect(typeof result === 'object' && result !== null && 'error' in result).toBe(false)
    const after = documentState()
    expect(after).not.toBe(before)
    expect(store.undo.undoDepth).toBe(depth + 1)

    store.undo.undo()
    expect(documentState()).toBe(before)
    store.undo.redo()
    expect(documentState()).toBe(after)
  })
})
