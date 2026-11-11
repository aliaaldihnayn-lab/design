import { describe, expect, test } from 'bun:test'

import { SceneGraph } from '@lawha/scene-graph'

import { playIslandRoots } from '#core/editor/play/islands'
import { resolvePlayState } from '#core/editor/play/states'
import { setPluginData } from '#core/figma-api/plugin-data'
import { INTERACTIONS_KEY, type Interaction } from '#core/prototype/model'
import { dispatchStateEvent, variantValues } from '#core/prototype/states'
import {
  boundInstanceStates,
  conditionsHold,
  instanceScope,
  playKey,
  PROPERTY_BINDINGS_KEY,
  runVariableActions,
  withVariableScope
} from '#core/prototype/variables'

const INSTANT = { type: 'instant', direction: 'left', duration: 0, easing: 'linear' } as const

/**
 * A terms screen: a Checkbox set (Unchecked, Checked) whose click toggles `agreed` and changes
 * to the other variant, a Button set (Disabled, Default) whose State follows `agreed`, and a
 * label bound to `country`.
 */
function fixture() {
  const graph = new SceneGraph()
  const pageId = graph.getPages()[0]?.id ?? graph.rootId
  const collection = graph.createCollection('Prototype')
  const agreed = graph.createVariable('agreed', 'BOOLEAN', collection.id, false)
  const country = graph.createVariable('country', 'STRING', collection.id, 'Choose')

  const checkboxes = graph.createNode('COMPONENT_SET', pageId, {
    name: 'Checkbox',
    componentPropertyDefinitions: [
      {
        id: 'c',
        name: 'Checked',
        type: 'VARIANT',
        defaultValue: 'false',
        variantOptions: ['false', 'true']
      }
    ]
  })
  const unchecked = graph.createNode('COMPONENT', checkboxes.id, {
    name: 'Checked=false',
    width: 20,
    height: 20,
    componentPropertyValues: { Checked: 'false' }
  })
  const checked = graph.createNode('COMPONENT', checkboxes.id, {
    name: 'Checked=true',
    x: 30,
    width: 20,
    height: 20,
    componentPropertyValues: { Checked: 'true' }
  })
  const toggle = (destination: string): Interaction => ({
    trigger: { type: 'click' },
    action: {
      type: 'conditional',
      when: [{ variable: agreed.id, op: 'truthy' }],
      actions: [
        { type: 'set-variable', variable: agreed.id, value: false },
        { type: 'change-to', destination, transition: INSTANT }
      ],
      otherwise: [
        { type: 'set-variable', variable: agreed.id, value: true },
        { type: 'change-to', destination, transition: INSTANT }
      ]
    }
  })
  setPluginData(graph, unchecked, INTERACTIONS_KEY, JSON.stringify([toggle(checked.id)]))
  setPluginData(graph, checked, INTERACTIONS_KEY, JSON.stringify([toggle(unchecked.id)]))

  const buttons = graph.createNode('COMPONENT_SET', pageId, {
    name: 'Button',
    y: 100,
    componentPropertyDefinitions: [
      {
        id: 's',
        name: 'State',
        type: 'VARIANT',
        defaultValue: 'Disabled',
        variantOptions: ['Disabled', 'Default']
      }
    ]
  })
  const disabled = graph.createNode('COMPONENT', buttons.id, {
    name: 'State=Disabled',
    width: 80,
    height: 32,
    componentPropertyValues: { State: 'Disabled' }
  })
  graph.createNode('COMPONENT', buttons.id, {
    name: 'State=Default',
    x: 100,
    width: 80,
    height: 32,
    componentPropertyValues: { State: 'Default' }
  })

  const screen = graph.createNode('FRAME', pageId, {
    name: 'Terms',
    y: 300,
    width: 300,
    height: 200
  })
  const box = graph.createInstance(unchecked.id, screen.id, { x: 10, y: 10 })
  const submit = graph.createInstance(disabled.id, screen.id, { x: 10, y: 60 })
  if (!box || !submit) throw new Error('instances not created')
  graph.updateNode(box.id, { name: 'Agree' })
  graph.updateNode(submit.id, { name: 'Submit' })
  setPluginData(
    graph,
    submit,
    PROPERTY_BINDINGS_KEY,
    JSON.stringify({ State: { variable: agreed.id, on: 'Default', off: 'Disabled' } })
  )
  const label = graph.createNode('TEXT', screen.id, {
    name: 'Country label',
    y: 120,
    text: 'Choose'
  })
  graph.updateNode(label.id, { boundVariables: { text: country.id } })
  return { graph, pageId, screen, agreed, country, checked, unchecked }
}

describe('prototype variables', () => {
  test('Set variable sets, toggles, and adds; the document keeps its values', () => {
    const { graph, agreed, country } = fixture()
    const collection = graph.createCollection('Counts')
    const count = graph.createVariable('count', 'FLOAT', collection.id, 2)
    const { variables, actions } = runVariableActions(graph, new Map(), [
      { type: 'set-variable', variable: agreed.id, toggle: true },
      { type: 'set-variable', variable: country.id, value: 'Oman' },
      { type: 'set-variable', variable: count.id, add: 3 },
      { type: 'close-overlay' }
    ])
    expect([...variables]).toEqual([
      [agreed.id, true],
      [country.id, 'Oman'],
      [count.id, 5]
    ])
    expect(actions).toEqual([{ type: 'close-overlay' }])
    expect(graph.resolveVariable(country.id)).toBe('Choose')
  })

  test('conditions compare running values', () => {
    const { graph, agreed, country } = fixture()
    const set = new Map([[country.id, 'Oman']])
    expect(conditionsHold(graph, set, [{ variable: country.id, op: 'eq', value: 'Oman' }])).toBe(
      true
    )
    expect(conditionsHold(graph, set, [{ variable: agreed.id, op: 'falsy' }])).toBe(true)
    expect(
      conditionsHold(graph, new Map([[agreed.id, 3]]), [
        { variable: agreed.id, op: 'gt', value: 2 }
      ])
    ).toBe(true)
    expect(conditionsHold(graph, set, [{ variable: country.id, op: 'neq', value: 'Oman' }])).toBe(
      false
    )
  })

  test('a checkbox click enables a button through a shared variable', () => {
    const { graph, screen, agreed, checked, unchecked } = fixture()
    const show = (
      states: Map<string, string>,
      variables: Map<string, string | number | boolean>
    ) => {
      const instanceStates = new Map(
        [...states].map(([path, variant]) => [path, { variants: variantValues(graph, variant) }])
      )
      for (const [path, state] of boundInstanceStates(graph, screen.id, variables))
        instanceStates.set(path, {
          ...instanceStates.get(path),
          variants: { ...instanceStates.get(path)?.variants, ...state.variants }
        })
      return resolvePlayState(graph, screen.id, instanceStates, variables)
    }
    const variantOf = (shown: SceneGraph, name: string) => {
      const node = shown.getChildren(screen.id).find((child) => child.name === name)
      return node?.componentId ? shown.getNode(node.componentId)?.name : undefined
    }
    expect(variantOf(show(new Map(), new Map()), 'Submit')).toBe('State=Disabled')

    const first = dispatchStateEvent(
      show(new Map(), new Map()),
      screen.id,
      'Agree',
      'click',
      new Map()
    )
    expect(first.changes.map((change) => change.to)).toEqual([checked.id])
    expect(first.variables.get(agreed.id)).toBe(true)
    const states = new Map([['Agree', checked.id]])
    const variables = new Map(first.variables)
    expect(variantOf(show(states, variables), 'Submit')).toBe('State=Default')

    // Clicking again takes the other branch.
    const second = dispatchStateEvent(
      show(states, variables),
      screen.id,
      'Agree',
      'click',
      variables
    )
    expect(second.changes.map((change) => change.to)).toEqual([unchecked.id])
    expect(second.variables.get(agreed.id)).toBe(false)
  })

  test('bound text shows the running value; the frame runs live', () => {
    const { graph, pageId, screen, country } = fixture()
    const shown = resolvePlayState(graph, screen.id, new Map(), new Map([[country.id, 'Oman']]))
    const label = shown.getChildren(screen.id).find((node) => node.name === 'Country label')
    expect(label?.text).toBe('Oman')
    expect(playIslandRoots(graph, pageId)).toEqual([screen.id])
  })

  test('a per-instance variable is kept for the instance that sets it', () => {
    const { graph, screen, agreed } = fixture()
    const variable = graph.variables.get(agreed.id)
    if (!variable) throw new Error('no variable')
    variable.pluginData = withVariableScope(variable, 'instance')
    const result = dispatchStateEvent(
      resolvePlayState(graph, screen.id, new Map()),
      screen.id,
      'Agree',
      'click',
      new Map()
    )
    const scope = instanceScope(graph, screen.id, graph.getChildren(screen.id)[0]?.id ?? '')
    expect(result.variables.get(agreed.id)).toBeUndefined()
    expect(result.variables.get(playKey(graph, agreed.id, scope))).toBe(true)
    // The button, another instance, still reads the document's value.
    const submit = boundInstanceStates(graph, screen.id, result.variables).get('Submit')
    expect(submit?.variants.State).toBe('Disabled')
  })
})
