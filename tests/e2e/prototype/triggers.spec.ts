import { expect, test, useEditorSetup } from '#tests/e2e/fixtures'

const editor = useEditorSetup('/?test&no-rulers')

/** The live island a previewing canvas runs for a top-level layer. */
function island(layerId: string) {
  return editor.page.locator(`[data-island="${layerId}"]`)
}

function layer(islandId: string, path: string) {
  return island(islandId).locator(`[data-layer="${path}"]`)
}

async function startLiveMode() {
  await editor.page.keyboard.press('ControlOrMeta+Alt+Enter')
  await expect(editor.page.getByRole('button', { name: /Leave preview/ })).toBeVisible()
}

async function leaveLiveMode() {
  await editor.page.keyboard.press('Escape')
  await expect(editor.page.getByRole('button', { name: /Leave preview/ })).toHaveCount(0)
}

/** Clears the page; the shared `clearCanvas` presses Meta+A, which selects nothing on Linux. */
async function clearPage() {
  await editor.page.keyboard.press('Escape')
  await editor.page.evaluate(() => {
    const store = window.lawha?.getStore?.()
    if (!store) throw new Error('Lawha store not initialized')
    for (const node of store.graph.getChildren(store.state.currentPageId))
      store.graph.deleteNode(node.id)
    store.requestRender()
  })
}

const TRIGGERS = [
  'click',
  'hover',
  'press',
  'mouse-enter',
  'mouse-leave',
  'mouse-down',
  'mouse-up',
  'focus',
  'blur',
  'drag',
  'key',
  'after-delay'
] as const
type TriggerName = (typeof TRIGGERS)[number]

/**
 * A screen with one instance per trigger: each comes from its own component set whose Rest
 * variant changes to Fired when its trigger happens, and whose label says which one it shows.
 */
async function createTriggerScreen() {
  return editor.page.evaluate((triggers) => {
    const store = window.lawha?.getStore?.()
    if (!store) throw new Error('Lawha store not initialized')
    const graph = store.graph
    const pageId = store.state.currentPageId
    const solid = (r: number, g: number, b: number) => [
      { type: 'SOLID' as const, color: { r, g, b, a: 1 }, opacity: 1, visible: true }
    ]
    const screen = graph.createNode('FRAME', pageId, {
      name: 'Screen',
      x: 0,
      y: 0,
      width: 640,
      height: 360,
      fills: solid(0.98, 0.98, 0.99)
    })
    const instances: Record<string, string> = {}
    triggers.forEach((name, index) => {
      const set = graph.createNode('COMPONENT_SET', pageId, {
        name: `Probe ${name}`,
        x: 800 + (index % 4) * 200,
        y: Math.floor(index / 4) * 200,
        width: 160,
        height: 140,
        componentPropertyDefinitions: [
          {
            id: 'state',
            name: 'State',
            type: 'VARIANT',
            defaultValue: 'Rest',
            variantOptions: ['Rest', 'Fired']
          }
        ]
      })
      const variant = (state: string, y: number) => {
        const node = graph.createNode('COMPONENT', set.id, {
          name: `State=${state}`,
          x: 10,
          y,
          width: 140,
          height: 48,
          fills: state === 'Rest' ? solid(0.85, 0.87, 0.9) : solid(0.2, 0.6, 0.3),
          componentPropertyValues: { State: state }
        })
        graph.createNode('TEXT', node.id, {
          name: 'Label',
          x: 8,
          y: 12,
          width: 120,
          height: 20,
          text: state
        })
        return node
      }
      const rest = variant('Rest', 10)
      const fired = variant('Fired', 74)
      const triggers: Record<string, unknown> = {
        key: { type: 'key', key: 'k' },
        'after-delay': { type: 'after-delay', delay: 400 }
      }
      const trigger = triggers[name] ?? { type: name }
      const transition = { type: 'instant', direction: 'left', duration: 0, easing: 'linear' }
      graph.updateNode(rest.id, {
        pluginData: [
          {
            pluginId: 'lawha',
            key: 'prototype.interactions',
            value: JSON.stringify([
              { trigger, action: { type: 'change-to', destination: fired.id, transition } }
            ])
          }
        ]
      })
      const instance = graph.createInstance(rest.id, screen.id, {
        x: 20 + (index % 4) * 155,
        y: 20 + Math.floor(index / 4) * 110
      })
      if (!instance) throw new Error(`No instance for ${name}`)
      graph.updateNode(instance.id, { name })
      instances[name] = instance.id
    })
    store.clearSelection()
    store.zoomToFit()
    store.requestRender()
    return { screen: screen.id, instances }
  }, TRIGGERS)
}

test('every trigger runs on the canvas in live mode, and while-triggers undo when they end', async () => {
  await clearPage()
  const { screen } = await createTriggerScreen()
  await editor.canvas.waitForRender()
  await startLiveMode()
  const page = editor.page
  const label = (name: TriggerName) => layer(screen, `${name}/Label`)
  const box = async (name: TriggerName) => {
    const found = await layer(screen, name).boundingBox()
    if (!found) throw new Error(`${name} is not on screen`)
    return { x: found.x + found.width / 2, y: found.y + found.height / 2 }
  }
  const away = { x: 4, y: 700 }

  // An after-delay change fires by itself, once its variant shows.
  await expect(label('after-delay')).toHaveText('Fired')
  for (const name of TRIGGERS.filter((item) => item !== 'after-delay'))
    await expect(label(name)).toHaveText('Rest')

  await layer(screen, 'click').click()
  await expect(label('click')).toHaveText('Fired')

  // While hovering: Fired over the layer, Rest again once the pointer leaves.
  await page.mouse.move(...(Object.values(await box('hover')) as [number, number]))
  await expect(label('hover')).toHaveText('Fired')
  await page.mouse.move(away.x, away.y)
  await expect(label('hover')).toHaveText('Rest')

  // While pressing: Fired while the button is down, Rest once it lifts.
  const press = await box('press')
  await page.mouse.move(press.x, press.y)
  await page.mouse.down()
  await expect(label('press')).toHaveText('Fired')
  await page.mouse.up()
  await expect(label('press')).toHaveText('Rest')

  const enter = await box('mouse-enter')
  await page.mouse.move(enter.x, enter.y)
  await expect(label('mouse-enter')).toHaveText('Fired')
  await page.mouse.move(away.x, away.y)
  // Mouse enter fires once and stays.
  await expect(label('mouse-enter')).toHaveText('Fired')

  const leave = await box('mouse-leave')
  await page.mouse.move(leave.x, leave.y)
  await expect(label('mouse-leave')).toHaveText('Rest')
  await page.mouse.move(away.x, away.y)
  await expect(label('mouse-leave')).toHaveText('Fired')

  const down = await box('mouse-down')
  await page.mouse.move(down.x, down.y)
  await page.mouse.down()
  await expect(label('mouse-down')).toHaveText('Fired')
  await page.mouse.up()
  await expect(label('mouse-down')).toHaveText('Fired')

  const up = await box('mouse-up')
  await page.mouse.move(up.x, up.y)
  await page.mouse.down()
  await expect(label('mouse-up')).toHaveText('Rest')
  await page.mouse.up()
  await expect(label('mouse-up')).toHaveText('Fired')

  // A layer with focus triggers takes focus from the keyboard; blur fires when focus leaves.
  await layer(screen, 'focus').focus()
  await expect(label('focus')).toHaveText('Fired')
  await page.keyboard.press('Tab')
  await expect(layer(screen, 'blur')).toBeFocused()
  await expect(label('blur')).toHaveText('Rest')
  await layer(screen, 'blur').blur()
  await expect(label('blur')).toHaveText('Fired')

  const drag = await box('drag')
  await page.mouse.move(drag.x, drag.y)
  await page.mouse.down()
  for (let step = 1; step <= 6; step++) await page.mouse.move(drag.x + step * 6, drag.y)
  await page.mouse.up()
  await expect(label('drag')).toHaveText('Fired')

  await page.mouse.move(away.x, away.y)
  await page.keyboard.press('k')
  await expect(label('key')).toHaveText('Fired')

  await leaveLiveMode()
  // The document is left as designed.
  const shown = await page.evaluate((screenId) => {
    const store = window.lawha?.getStore?.()
    const graph = store?.graph
    const ids = graph?.getNode(screenId)?.childIds ?? []
    return ids.map((id) => graph?.getNode(graph.getNode(id)?.componentId ?? '')?.name)
  }, screen)
  expect(new Set(shown)).toEqual(new Set(['State=Rest']))
})

/**
 * Two counters of each kind on a screen: the per-instance counter keeps a count for each
 * instance, the shared one a count every instance shows; a gate shows whether the shared count
 * reached two, through a conditional.
 */
async function createCounterScreen() {
  return editor.page.evaluate(() => {
    const store = window.lawha?.getStore?.()
    if (!store) throw new Error('Lawha store not initialized')
    const graph = store.graph
    const pageId = store.state.currentPageId
    const solid = (r: number, g: number, b: number) => [
      { type: 'SOLID' as const, color: { r, g, b, a: 1 }, opacity: 1, visible: true }
    ]
    const collection = graph.createCollection('Counters')
    const own = graph.createVariable('own count', 'FLOAT', collection.id, 0)
    own.pluginData = [{ pluginId: 'lawha', key: 'prototype.scope', value: 'instance' }]
    const shared = graph.createVariable('shared count', 'FLOAT', collection.id, 0)
    const verdict = graph.createVariable('verdict', 'STRING', collection.id, 'low')
    const interactions = (id: string, list: unknown[]) =>
      graph.updateNode(id, {
        pluginData: [
          { pluginId: 'lawha', key: 'prototype.interactions', value: JSON.stringify(list) }
        ]
      })
    const counter = (name: string, variable: string, x: number) => {
      const component = graph.createNode('COMPONENT', pageId, {
        name,
        x,
        y: 500,
        width: 160,
        height: 48,
        fills: solid(0.92, 0.93, 0.95)
      })
      const count = graph.createNode('TEXT', component.id, {
        name: 'Count',
        x: 8,
        y: 12,
        width: 60,
        height: 20,
        text: '0'
      })
      graph.updateNode(count.id, { boundVariables: { text: variable } })
      const plus = graph.createNode('FRAME', component.id, {
        name: 'Plus',
        x: 110,
        y: 8,
        width: 40,
        height: 32,
        fills: solid(0.2, 0.4, 0.9)
      })
      interactions(plus.id, [
        {
          trigger: { type: 'click' },
          action: { type: 'set-variable', variable, add: 1 },
          andThen: [
            {
              type: 'conditional',
              when: [{ variable: shared.id, op: 'gte', value: 2 }],
              actions: [{ type: 'set-variable', variable: verdict.id, value: 'high' }],
              otherwise: [{ type: 'set-variable', variable: verdict.id, value: 'low' }]
            }
          ]
        }
      ])
      return component
    }
    const ownCounter = counter('Own counter', own.id, 0)
    const sharedCounter = counter('Shared counter', shared.id, 200)
    const screen = graph.createNode('FRAME', pageId, {
      name: 'Counters',
      x: 0,
      y: 0,
      width: 400,
      height: 260,
      fills: solid(1, 1, 1)
    })
    const place = (componentId: string, name: string, x: number, y: number) => {
      const instance = graph.createInstance(componentId, screen.id, { x, y })
      if (!instance) throw new Error('No instance')
      graph.updateNode(instance.id, { name })
    }
    place(ownCounter.id, 'Own A', 20, 20)
    place(ownCounter.id, 'Own B', 200, 20)
    place(sharedCounter.id, 'Shared A', 20, 100)
    place(sharedCounter.id, 'Shared B', 200, 100)
    const gate = graph.createNode('TEXT', screen.id, {
      name: 'Verdict',
      x: 20,
      y: 200,
      width: 100,
      height: 20,
      text: 'low'
    })
    graph.updateNode(gate.id, { boundVariables: { text: verdict.id } })
    store.clearSelection()
    store.zoomToFit()
    store.requestRender()
    return { screen: screen.id, shared: shared.id }
  })
}

test('a per-instance variable counts for each instance, a shared one for all, and a conditional reads it', async () => {
  await clearPage()
  const { screen, shared } = await createCounterScreen()
  await editor.canvas.waitForRender()
  await startLiveMode()

  await layer(screen, 'Own A/Plus').click()
  await layer(screen, 'Own A/Plus').click()
  await layer(screen, 'Own B/Plus').click()
  await expect(layer(screen, 'Own A/Count')).toHaveText('2')
  await expect(layer(screen, 'Own B/Count')).toHaveText('1')

  await layer(screen, 'Shared A/Plus').click()
  await expect(layer(screen, 'Shared A/Count')).toHaveText('1')
  await expect(layer(screen, 'Shared B/Count')).toHaveText('1')
  await expect(layer(screen, 'Verdict')).toHaveText('low')
  await layer(screen, 'Shared B/Plus').click()
  await expect(layer(screen, 'Shared A/Count')).toHaveText('2')
  await expect(layer(screen, 'Verdict')).toHaveText('high')

  // Reset starts every variable again from the document's value.
  await editor.page.getByRole('button', { name: 'Reset' }).click()
  await expect(layer(screen, 'Own A/Count')).toHaveText('0')
  await expect(layer(screen, 'Shared B/Count')).toHaveText('0')
  await expect(layer(screen, 'Verdict')).toHaveText('low')
  await leaveLiveMode()

  // The document keeps the variables' own values.
  const value = await editor.page.evaluate((id) => {
    const variable = window.lawha?.getStore?.()?.graph.variables.get(id)
    return variable ? Object.values(variable.valuesByMode)[0] : undefined
  }, shared)
  expect(value).toBe(0)
})
