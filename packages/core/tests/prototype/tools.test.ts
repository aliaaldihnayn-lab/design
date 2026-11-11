import { describe, expect, test } from 'bun:test'

import { FigmaAPI } from '@lawha/core/figma-api'
import { ALL_TOOLS, isToolExposed } from '@lawha/core/tools'
import { SceneGraph } from '@lawha/scene-graph'

import { resolvePlayState } from '#core/editor/play/states'
import { dispatchStateEvent, variantValues } from '#core/prototype/states'
import { boundInstanceStates, readPropertyBindings } from '#core/prototype/variables'

function tool(name: string) {
  const found = ALL_TOOLS.find((item) => item.name === name)
  if (!found) throw new Error(`No tool ${name}`)
  return (figma: FigmaAPI, args: Record<string, unknown>) => found.execute(figma, args)
}

function must<T>(value: T | null | undefined): T {
  if (value == null) throw new Error('expected a value')
  return value
}

/** A tool result's fields, or a failure that shows what came back instead. */
function fields(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`Expected an object: ${JSON.stringify(value)}`)
  }
  return Object.fromEntries(Object.entries(value))
}

function idOf(value: unknown): string {
  const id = fields(value).id
  if (typeof id !== 'string') throw new Error(`Expected an id: ${JSON.stringify(value)}`)
  return id
}

/** A dropdown frame with a trigger and a menu, on a page with a screen to hold it. */
function dropdownFrame() {
  const figma = new FigmaAPI(new SceneGraph())
  const frame = figma.createFrame()
  frame.name = 'Dropdown'
  frame.resize(200, 120)
  const trigger = figma.createFrame()
  frame.appendChild(trigger)
  trigger.name = 'Trigger'
  trigger.resize(200, 40)
  return { figma, frame }
}

describe('interactive component tools', () => {
  test('create_interactive_component makes states of one set and wires Change to', async () => {
    const { figma, frame } = dropdownFrame()
    const result = must(
      await tool('create_interactive_component')(figma, {
        id: frame.id,
        states: ['Closed', 'Open'],
        interactions: [
          { from: 'Closed', layer: 'Trigger', trigger: { type: 'click' }, to: 'Open' },
          {
            from: 'Open',
            layer: 'Trigger',
            trigger: { type: 'click' },
            to: 'Closed',
            transition: { type: 'dissolve', direction: 'left', duration: 120, easing: 'ease-in' }
          }
        ]
      })
    )
    const variants = fields(result).variants
    if (!Array.isArray(variants)) throw new Error(JSON.stringify(result))
    const setId = idOf(result)
    expect(variants.map((variant) => fields(variant).name)).toEqual(['State=Closed', 'State=Open'])

    const graph = figma.graph
    const pageId = figma.currentPage.id
    const closed = must(graph.getChildren(setId).find((node) => node.name === 'State=Closed'))
    const open = must(graph.getChildren(setId).find((node) => node.name === 'State=Open'))
    const screen = graph.createNode('FRAME', pageId, {
      name: 'Screen',
      x: 600,
      width: 300,
      height: 300
    })
    const instance = must(graph.createInstance(closed.id, screen.id, { x: 10, y: 10 }))
    graph.updateNode(instance.id, { name: 'Menu' })
    const shown = resolvePlayState(graph, screen.id, new Map())
    const click = dispatchStateEvent(shown, screen.id, 'Menu/Trigger', 'click')
    expect(click.changes.map((change) => change.to)).toEqual([open.id])

    const reopened = resolvePlayState(
      graph,
      screen.id,
      new Map([['Menu', { variants: variantValues(graph, open.id) }]])
    )
    const close = dispatchStateEvent(reopened, screen.id, 'Menu/Trigger', 'click')
    expect(close.changes[0]?.transition.type).toBe('dissolve')
  })

  test('add_state_interaction names missing states and layers', async () => {
    const { figma, frame } = dropdownFrame()
    const made = must(
      await tool('create_interactive_component')(figma, { id: frame.id, states: ['Off', 'On'] })
    )
    const setId = idOf(made)
    const add = tool('add_state_interaction')
    expect(
      await add(figma, { set_id: setId, from: 'Maybe', trigger: { type: 'click' }, to: 'On' })
    ).toEqual({
      error: 'Dropdown has no state Maybe'
    })
    expect(
      await add(figma, {
        set_id: setId,
        from: 'Off',
        layer: 'Knob',
        trigger: { type: 'click' },
        to: 'On'
      })
    ).toEqual({
      error: 'State=Off has no layer Knob'
    })
    expect(
      await add(figma, { set_id: setId, from: 'Off', trigger: { type: 'hover' }, to: 'On' })
    ).toEqual({
      set_id: setId,
      from: 'Off',
      to: 'On'
    })
  })

  test('bind_property_to_variable makes an instance follow a variable', async () => {
    const { figma, frame } = dropdownFrame()
    const made = must(
      await tool('create_interactive_component')(figma, {
        id: frame.id,
        states: ['Disabled', 'Default']
      })
    )
    const setId = idOf(made)
    const graph = figma.graph
    const collection = graph.createCollection('Prototype')
    const agreed = graph.createVariable('agreed', 'BOOLEAN', collection.id, false)
    const disabled = must(graph.getChildren(setId).find((node) => node.name === 'State=Disabled'))
    const screen = graph.createNode('FRAME', figma.currentPage.id, {
      name: 'Screen',
      x: 600,
      width: 300,
      height: 300
    })
    const instance = must(graph.createInstance(disabled.id, screen.id))
    await tool('bind_property_to_variable')(figma, {
      instance_id: instance.id,
      property: 'State',
      variable: 'agreed',
      on: 'Default',
      off: 'Disabled'
    })
    expect(readPropertyBindings(must(graph.getNode(instance.id)))).toEqual({
      State: { variable: agreed.id, on: 'Default', off: 'Disabled' }
    })
    const states = boundInstanceStates(graph, screen.id, new Map([[agreed.id, true]]))
    expect([...states.values()][0]?.variants).toEqual({ State: 'Default' })
    await tool('bind_property_to_variable')(figma, {
      instance_id: instance.id,
      property: 'State',
      variable: null
    })
    expect(readPropertyBindings(must(graph.getNode(instance.id)))).toEqual({})
  })

  test('insert_kit_component inserts a live control at its centre', async () => {
    const figma = new FigmaAPI(new SceneGraph())
    const result = must(
      await tool('insert_kit_component')(figma, { kind: 'switch', x: 100, y: 100, centered: true })
    )
    const instance = must(figma.graph.getNode(idOf(result)))
    expect(instance.type).toBe('INSTANCE')
    expect(instance.x + instance.width / 2).toBe(100)
  })

  test('the tools reach AI chat and MCP', () => {
    for (const name of [
      'create_interactive_component',
      'add_state_interaction',
      'bind_property_to_variable',
      'insert_kit_component',
      'build_interactive_kit'
    ]) {
      const def = must(ALL_TOOLS.find((item) => item.name === name))
      expect(isToolExposed(def, 'ai')).toBe(true)
      expect(isToolExposed(def, 'mcp')).toBe(true)
    }
  })
})
