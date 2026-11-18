import { expect, test, useEditorSetupWithClear } from '#tests/e2e/fixtures'

const editor = useEditorSetupWithClear('/?test&no-rulers')

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

/**
 * A Dropdown component set whose Closed variant opens on click and whose Open variant closes
 * when an item is picked or Escape is pressed; a Dialog frame with a Close button; and a Screen
 * holding a Country dropdown and an Open dialog button that opens the dialog as an overlay.
 */
async function createScreen() {
  return editor.page.evaluate(() => {
    const store = window.lawha?.getStore?.()
    if (!store) throw new Error('Lawha store not initialized')
    const graph = store.graph
    const pageId = store.state.currentPageId
    const solid = (r: number, g: number, b: number) => [
      { type: 'SOLID' as const, color: { r, g, b, a: 1 }, opacity: 1, visible: true }
    ]
    const interactions = (id: string, list: unknown[]) => {
      const node = graph.getNode(id)
      if (!node) throw new Error(`No node ${id}`)
      graph.updateNode(id, {
        pluginData: [
          ...node.pluginData,
          { pluginId: 'lawha', key: 'prototype.interactions', value: JSON.stringify(list) }
        ]
      })
    }
    const transition = {
      type: 'smart-animate',
      direction: 'left',
      duration: 150,
      easing: 'ease-out'
    }
    const set = graph.createNode('COMPONENT_SET', pageId, {
      name: 'Dropdown',
      x: 600,
      y: 40,
      width: 260,
      height: 260,
      componentPropertyDefinitions: [
        {
          id: 'state',
          name: 'State',
          type: 'VARIANT',
          defaultValue: 'Closed',
          variantOptions: ['Closed', 'Open']
        }
      ]
    })
    const trigger = (parent: string) =>
      graph.createNode('FRAME', parent, {
        name: 'Trigger',
        width: 200,
        height: 40,
        cornerRadius: 6,
        fills: solid(0.93, 0.94, 0.96)
      })
    const closed = graph.createNode('COMPONENT', set.id, {
      name: 'State=Closed',
      x: 20,
      y: 20,
      width: 200,
      height: 40,
      componentPropertyValues: { State: 'Closed' }
    })
    const closedTrigger = trigger(closed.id)
    const open = graph.createNode('COMPONENT', set.id, {
      name: 'State=Open',
      x: 20,
      y: 80,
      width: 200,
      height: 140,
      componentPropertyValues: { State: 'Open' }
    })
    trigger(open.id)
    const menu = graph.createNode('FRAME', open.id, {
      name: 'Menu',
      y: 44,
      width: 200,
      height: 96,
      fills: solid(1, 1, 1)
    })
    const item = graph.createNode('FRAME', menu.id, {
      name: 'Item',
      width: 200,
      height: 48,
      fills: solid(0.2, 0.5, 1)
    })
    interactions(closedTrigger.id, [
      {
        trigger: { type: 'click' },
        action: { type: 'change-to', destination: open.id, transition }
      }
    ])
    interactions(item.id, [
      {
        trigger: { type: 'click' },
        action: { type: 'change-to', destination: closed.id, transition }
      }
    ])
    interactions(open.id, [
      {
        trigger: { type: 'key', key: 'Escape' },
        action: { type: 'change-to', destination: closed.id, transition }
      }
    ])

    const dialog = graph.createNode('FRAME', pageId, {
      name: 'Dialog',
      x: 600,
      y: 360,
      width: 240,
      height: 160,
      cornerRadius: 12,
      fills: solid(1, 1, 1)
    })
    const close = graph.createNode('FRAME', dialog.id, {
      name: 'Close',
      x: 160,
      y: 110,
      width: 64,
      height: 32,
      fills: solid(0.9, 0.2, 0.2)
    })
    interactions(close.id, [{ trigger: { type: 'click' }, action: { type: 'close-overlay' } }])

    const screen = graph.createNode('FRAME', pageId, {
      name: 'Screen',
      x: 40,
      y: 120,
      width: 360,
      height: 480,
      fills: solid(0.98, 0.98, 0.99)
    })
    const instance = graph.createInstance(closed.id, screen.id, { x: 20, y: 20 })
    if (!instance) throw new Error('Instance not created')
    graph.updateNode(instance.id, { name: 'Country' })
    const button = graph.createNode('FRAME', screen.id, {
      name: 'Open dialog',
      x: 20,
      y: 400,
      width: 160,
      height: 44,
      cornerRadius: 8,
      fills: solid(0.1, 0.4, 0.9)
    })
    interactions(button.id, [
      {
        trigger: { type: 'click' },
        action: {
          type: 'overlay',
          destination: dialog.id,
          position: 'center',
          closeOnOutside: true,
          background: '#00000066',
          transition: { type: 'dissolve', direction: 'left', duration: 120, easing: 'ease-out' }
        }
      }
    ])
    store.requestRender()
    return {
      screenId: screen.id,
      dialogId: dialog.id,
      instanceId: instance.id,
      closedId: closed.id
    }
  })
}

test('a dropdown opens and closes in place on the canvas in live mode', async () => {
  const ids = await createScreen()
  await editor.canvas.waitForRender()
  await startLiveMode()

  // The component set itself stays a drawing; the screen runs live.
  await expect(island(ids.screenId)).toBeVisible()
  await expect(editor.page.locator('[data-island]')).toHaveCount(2)

  await expect(layer(ids.screenId, 'Country/Menu')).toHaveCount(0)
  await layer(ids.screenId, 'Country/Trigger').click()
  await expect(layer(ids.screenId, 'Country/Menu')).toBeVisible()
  await expect(layer(ids.screenId, 'Country/Menu/Item')).toBeVisible()
  await editor.page.mouse.move(4, 700)
  await expect(island(ids.screenId)).toHaveScreenshot('live-dropdown-open.png')

  // Picking an item closes it again.
  await layer(ids.screenId, 'Country/Menu/Item').click()
  await expect(layer(ids.screenId, 'Country/Menu')).toHaveCount(0)

  // Escape closes the open dropdown first, and leaves live mode only when pressed again.
  await layer(ids.screenId, 'Country/Trigger').click()
  await expect(layer(ids.screenId, 'Country/Menu')).toBeVisible()
  await editor.page.keyboard.press('Escape')
  await expect(layer(ids.screenId, 'Country/Menu')).toHaveCount(0)
  await expect(editor.page.getByRole('button', { name: /Leave preview/ })).toBeVisible()

  // The document still holds the closed variant.
  const componentId = await editor.page.evaluate(
    (id) => window.lawha?.getStore?.()?.graph.getNode(id)?.componentId,
    ids.instanceId
  )
  expect(componentId).toBe(ids.closedId)

  await editor.page.keyboard.press('Escape')
  await expect(editor.page.getByRole('button', { name: /Leave preview/ })).toHaveCount(0)
})

test('a modal opens over its frame and closes from its button or the backdrop', async () => {
  const ids = await createScreen()
  await editor.canvas.waitForRender()
  await startLiveMode()

  const overlay = island(ids.screenId).locator(`[data-overlay="${ids.dialogId}"]`)
  await layer(ids.screenId, 'Open dialog').click()
  await expect(overlay).toBeVisible()
  await expect(overlay.getByRole('dialog')).toBeVisible()
  await editor.page.mouse.move(4, 700)
  await expect(island(ids.screenId)).toHaveScreenshot('live-modal-open.png')

  await overlay.locator('[data-layer="Close"]').click()
  await expect(overlay).toHaveCount(0)

  await layer(ids.screenId, 'Open dialog').click()
  await expect(overlay).toBeVisible()
  // A click on the dimmed backdrop, outside the dialog, closes it.
  await overlay.click({ position: { x: 8, y: 8 } })
  await expect(overlay).toHaveCount(0)
})

/**
 * A terms screen: an Agree checkbox (Unchecked and Checked variants) whose click toggles the
 * `agreed` variable and changes variant, a Submit button whose State follows `agreed`, and a
 * label that shows the `agreed` value as text.
 */
async function createTerms() {
  return editor.page.evaluate(() => {
    const store = window.lawha?.getStore?.()
    if (!store) throw new Error('Lawha store not initialized')
    const graph = store.graph
    const pageId = store.state.currentPageId
    const solid = (r: number, g: number, b: number) => [
      { type: 'SOLID' as const, color: { r, g, b, a: 1 }, opacity: 1, visible: true }
    ]
    const plugin = (id: string, key: string, value: unknown) => {
      const node = graph.getNode(id)
      if (!node) throw new Error(`No node ${id}`)
      graph.updateNode(id, {
        pluginData: [...node.pluginData, { pluginId: 'lawha', key, value: JSON.stringify(value) }]
      })
    }
    const collection = graph.createCollection('Prototype')
    const agreed = graph.createVariable('agreed', 'BOOLEAN', collection.id, false)
    const instant = { type: 'instant', direction: 'left', duration: 0, easing: 'linear' }
    const checkboxes = graph.createNode('COMPONENT_SET', pageId, {
      name: 'Checkbox',
      x: 600,
      y: 600,
      width: 120,
      height: 60,
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
    const variant = (checked: boolean) =>
      graph.createNode('COMPONENT', checkboxes.id, {
        name: `Checked=${checked}`,
        x: checked ? 60 : 10,
        y: 10,
        width: 24,
        height: 24,
        cornerRadius: 4,
        fills: checked ? solid(0.1, 0.5, 1) : solid(0.85, 0.85, 0.88),
        componentPropertyValues: { Checked: String(checked) }
      })
    const unchecked = variant(false)
    const checked = variant(true)
    for (const [from, to] of [
      [unchecked, checked],
      [checked, unchecked]
    ])
      plugin(from.id, 'prototype.interactions', [
        {
          trigger: { type: 'click' },
          action: { type: 'set-variable', variable: agreed.id, toggle: true },
          andThen: [{ type: 'change-to', destination: to.id, transition: instant }]
        }
      ])
    const buttons = graph.createNode('COMPONENT_SET', pageId, {
      name: 'Button',
      x: 600,
      y: 700,
      width: 260,
      height: 60,
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
      x: 10,
      y: 10,
      width: 100,
      height: 36,
      fills: solid(0.8, 0.8, 0.8),
      componentPropertyValues: { State: 'Disabled' }
    })
    graph.createNode('COMPONENT', buttons.id, {
      name: 'State=Default',
      x: 130,
      y: 10,
      width: 100,
      height: 36,
      fills: solid(0.1, 0.6, 0.3),
      componentPropertyValues: { State: 'Default' }
    })
    const screen = graph.createNode('FRAME', pageId, {
      name: 'Terms',
      x: 40,
      y: 120,
      width: 320,
      height: 200,
      fills: solid(1, 1, 1)
    })
    const box = graph.createInstance(unchecked.id, screen.id, { x: 20, y: 20 })
    const submit = graph.createInstance(disabled.id, screen.id, { x: 20, y: 120 })
    if (!box || !submit) throw new Error('Instances not created')
    graph.updateNode(box.id, { name: 'Agree' })
    graph.updateNode(submit.id, { name: 'Submit' })
    plugin(submit.id, 'prototype.bindings', {
      State: { variable: agreed.id, on: 'Default', off: 'Disabled' }
    })
    store.requestRender()
    return { screenId: screen.id }
  })
}

test('a checkbox enables a button through a prototype variable', async () => {
  const ids = await createTerms()
  await editor.canvas.waitForRender()
  await startLiveMode()

  const submit = layer(ids.screenId, 'Submit')
  await expect(submit).toHaveCSS('background-color', 'rgb(204, 204, 204)')
  await layer(ids.screenId, 'Agree').click()
  await expect(submit).toHaveCSS('background-color', 'rgb(26, 153, 77)')
  await layer(ids.screenId, 'Agree').click()
  await expect(submit).toHaveCSS('background-color', 'rgb(204, 204, 204)')
  await editor.page.keyboard.press('Escape')
})
