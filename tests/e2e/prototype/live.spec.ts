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
