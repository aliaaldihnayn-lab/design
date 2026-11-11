import { describe, expect, test } from 'bun:test'

import { expectDefined } from '#core-tests/helpers/assert'
import { CalendarDate } from '@internationalized/date'

import { SceneGraph, type SceneNode } from '@lawha/scene-graph'
import { readBehaviour } from '@lawha/scene-graph/behaviours'

import {
  buildKit,
  buildKitComponent,
  insertKitComponent,
  KIT_KINDS,
  KIT_PAGE_NAME
} from '#core/design-system/kit'
import { playIslandRoots } from '#core/editor/play/islands'
import { resolvePlayState } from '#core/editor/play/states'
import { dispatchStateEvent, dispatchStateKey, variantValues } from '#core/prototype/states'
import type { PlayVariables } from '#core/prototype/variables'

const TODAY = new CalendarDate(2026, 11, 11)

/** A screen holding an instance of a kit control. */
async function screenWith(kind: (typeof KIT_KINDS)[number], options = {}) {
  const graph = new SceneGraph()
  const pageId = graph.getPages()[0]?.id ?? graph.rootId
  const screen = graph.createNode('FRAME', pageId, { name: 'Screen', width: 400, height: 800 })
  const { instanceId, component } = await insertKitComponent(graph, kind, {
    parentId: screen.id,
    x: 20,
    y: 20,
    today: TODAY,
    ...options
  })
  const instance = graph.getNode(instanceId)
  if (!instance) throw new Error('no instance')
  return { graph, pageId, screen, instance, component }
}

/** The screen as it shows with instances in the given variants and variables. */
function show(
  graph: SceneGraph,
  rootId: string,
  states: Map<string, string>,
  variables: PlayVariables
) {
  return resolvePlayState(
    graph,
    rootId,
    new Map([...states].map(([path, id]) => [path, { variants: variantValues(graph, id) }])),
    variables
  )
}

function textOf(graph: SceneGraph, root: SceneNode, name: string): string | undefined {
  const walk = (node: SceneNode): string | undefined => {
    if (node.type === 'TEXT' && node.name === name) return node.text
    for (const child of graph.getChildren(node.id)) {
      const found = walk(child)
      if (found !== undefined) return found
    }
    return undefined
  }
  return walk(root)
}

describe('interactive kit', () => {
  test('every control builds once, on the kit page, and is reused', async () => {
    const graph = new SceneGraph()
    const built = await buildKit(graph, KIT_KINDS, { today: TODAY })
    expect(built.map((item) => item.kind)).toEqual([...KIT_KINDS])
    expect(built.every((item) => item.created)).toBe(true)
    const page = graph.getPages().find((item) => item.name === KIT_PAGE_NAME)
    expect(page).toBeDefined()
    const again = await buildKitComponent(graph, 'select', { today: TODAY })
    expect(again.created).toBe(false)
    expect(again.id).toBe(expectDefined(built.find((item) => item.kind === 'select')).id)
  })

  test('the button keeps every state as a variant of one set', async () => {
    const graph = new SceneGraph()
    const button = await buildKitComponent(graph, 'button')
    const names = graph.getChildren(button.id).map((variant) => variant.name)
    expect(names).toEqual([
      'State=Default',
      'State=Hover',
      'State=Pressed',
      'State=Focus',
      'State=Disabled',
      'State=Loading'
    ])
  })

  test('a select opens in place, moves with the arrow keys, and shows the pick', async () => {
    const { graph, pageId, screen, instance } = await screenWith('select')
    expect(playIslandRoots(graph, pageId)).toEqual([screen.id])
    const path = instance.name
    let states = new Map<string, string>()
    let variables: PlayVariables = new Map()
    const variant = (name: string) => {
      const set = graph.getNode(graph.getNode(instance.componentId ?? '')?.parentId ?? '')
      const found = set && graph.getChildren(set.id).find((child) => child.name === name)
      if (!found) throw new Error(`no ${name}`)
      return found.id
    }
    const step = (result: ReturnType<typeof dispatchStateEvent>) => {
      for (const change of result.changes) states = new Map(states).set(change.instance, change.to)
      variables = result.variables
    }

    step(
      dispatchStateEvent(
        show(graph, screen.id, states, variables),
        screen.id,
        `${path}/Trigger`,
        'click',
        variables
      )
    )
    expect(states.get(path)).toBe(variant('State=Open'))
    step(
      dispatchStateKey(show(graph, screen.id, states, variables), screen.id, 'ArrowDown', variables)
    )
    step(
      dispatchStateKey(show(graph, screen.id, states, variables), screen.id, 'ArrowDown', variables)
    )
    expect(states.get(path)).toBe(variant('State=Option 2'))
    step(dispatchStateKey(show(graph, screen.id, states, variables), screen.id, 'Enter', variables))
    expect(states.get(path)).toBe(variant('State=Closed'))
    const shown = show(graph, screen.id, states, variables)
    const root = shown.getNode(screen.id)
    if (!root) throw new Error('no screen')
    expect(textOf(shown, root, 'Value')).toBe('Jeddah')
  })

  test('text fields run as Reka controls with a counter and a clear button', async () => {
    const graph = new SceneGraph()
    for (const kind of ['text-input', 'textarea', 'search'] as const) {
      const built = await buildKitComponent(graph, kind)
      const set = graph.getNode(built.id)
      const behaviour = set && readBehaviour(set)
      expect(behaviour?.kind).toBe(kind === 'textarea' ? 'textarea' : 'textField')
      expect(Object.keys(behaviour?.texts ?? {}).sort()).toEqual(
        kind === 'search' ? ['value'] : ['count', 'value']
      )
      if (kind === 'search') expect(Object.keys(behaviour?.parts ?? {})).toEqual(['clear'])
    }
  })

  test('right to left lays rows out from the right with Arabic labels', async () => {
    const { graph, instance } = await screenWith('select', { rtl: true })
    const page = graph.getPages().find((item) => item.name === 'Interactive kit (RTL)')
    expect(page).toBeDefined()
    const [trigger] = graph.getChildren(instance.id)
    expect(trigger.layoutDirection).toBe('RTL')
    expect(textOf(graph, instance, 'Value')).toBe('اختر مدينة')
  })

  test('the Hijri date picker draws Umm al-Qura months', async () => {
    const graph = new SceneGraph()
    const built = await buildKitComponent(graph, 'date-picker', {
      calendar: 'islamic-umalqura',
      today: TODAY
    })
    const set = graph.getNode(built.id)
    expect(set?.name).toBe('Kit/Date picker (Hijri)')
    const current =
      set && graph.getChildren(set.id).find((variant) => variant.name === 'State=Month 2')
    if (!current) throw new Error('no current month')
    // 11 November 2026 is in Jumada al-Akhirah 1448.
    expect(textOf(graph, current, 'Title')).toContain('1448')
  })

  test('picking a date range sets its start, then its end, which closes it', async () => {
    const { graph, screen, instance } = await screenWith('date-range-picker')
    const path = instance.name
    let states = new Map<string, string>()
    let variables: PlayVariables = new Map()
    const run = (target: string) => {
      const result = dispatchStateEvent(
        show(graph, screen.id, states, variables),
        screen.id,
        target,
        'click',
        variables
      )
      for (const change of result.changes) states = new Map(states).set(change.instance, change.to)
      variables = result.variables
    }
    run(`${path}/Field`)
    run(`${path}/Calendar/Days/Day 10`)
    run(`${path}/Calendar/Days/Day 12`)
    const shown = show(graph, screen.id, states, variables)
    const root = shown.getNode(screen.id)
    if (!root) throw new Error('no screen')
    expect(textOf(shown, root, 'Start')).toBe('Nov 10, 2026')
    expect(textOf(shown, root, 'End')).toBe('Nov 12, 2026')
    expect(shown.getChildren(screen.id)[0]?.componentId).toBe(
      graph.getChildren(
        graph.getNode(graph.getNode(instance.componentId ?? '')?.parentId ?? '')?.id ?? ''
      )[0]?.id
    )
  })

  test('a combobox filters its suggestions by what its field holds', async () => {
    for (const rtl of [false, true]) {
      const { graph, screen, instance } = await screenWith('combobox', { rtl })
      const path = instance.name
      const set = graph.getNode(graph.getNode(instance.componentId ?? '')?.parentId ?? '')
      const open = set && graph.getChildren(set.id).find((child) => child.name === 'State=Open')
      if (!open) throw new Error('no open variant')
      const shownWith = (query: string) => {
        const shown = resolvePlayState(
          graph,
          screen.id,
          new Map([[path, { variants: variantValues(graph, open.id) }]]),
          new Map(),
          new Map([[`${path}/Trigger/Field`, query]])
        )
        const menu = shown
          .getChildren(shown.getChildren(screen.id)[0]?.id ?? '')
          .find((child) => child.name === 'Menu')
        if (!menu) throw new Error('no menu')
        return shown
          .getChildren(menu.id)
          .filter((row) => row.visible)
          .map((row) => row.name)
      }
      expect(shownWith('')).toEqual(['Option 1', 'Option 2', 'Option 3', 'Option 4'])
      expect(shownWith(rtl ? 'جده' : 'JED')).toEqual(['Option 2'])
      expect(shownWith(rtl ? 'القاهرة' : 'Cairo')).toEqual(['Empty'])
    }
  })
})
