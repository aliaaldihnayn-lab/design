import { expect, test, useEditorSetupWithClear } from '#tests/e2e/fixtures'

const editor = useEditorSetupWithClear('/?test&no-rulers')

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
  await editor.page.getByRole('button', { name: /Leave preview/ }).click()
  await expect(editor.page.getByRole('button', { name: /Leave preview/ })).toHaveCount(0)
}

/** Inserts a kit control from the assets panel and returns the inserted instance's id. */
async function insertFromAssets(name: string): Promise<string> {
  await editor.page.getByTestId('left-panel-assets-tab').click()
  const kit = editor.page.getByTestId('assets-kit')
  await kit.getByRole('button', { name: `Insert ${name}`, exact: true }).click()
  const selectedInstance = () =>
    editor.page.evaluate(() => {
      const store = window.lawha?.getStore?.()
      const [selected] = store?.state.selectedIds ?? []
      return selected && store?.graph.getNode(selected)?.type === 'INSTANCE' ? selected : ''
    })
  await expect.poll(selectedInstance).not.toBe('')
  const id = await selectedInstance()
  await editor.page.getByTestId('left-panel-layers-tab').click()
  await editor.canvas.waitForRender()
  return id
}

test('a kit select opens on the canvas, moves with the keys, and shows the pick', async () => {
  const id = await insertFromAssets('Select')
  await startLiveMode()

  await expect(layer(id, 'Menu')).toHaveCount(0)
  await layer(id, 'Trigger').click()
  await expect(layer(id, 'Menu')).toBeVisible()
  await editor.page.mouse.move(4, 700)
  await expect(island(id)).toHaveScreenshot('kit-select-open.png')
  await editor.page.keyboard.press('ArrowDown')
  await editor.page.keyboard.press('ArrowDown')
  await editor.page.keyboard.press('Enter')
  await expect(layer(id, 'Menu')).toHaveCount(0)
  await expect(layer(id, 'Trigger/Value')).toHaveText('Jeddah')

  // Picking with the pointer shows that option instead.
  await layer(id, 'Trigger').click()
  await layer(id, 'Menu/Option 4').click()
  await expect(layer(id, 'Menu')).toHaveCount(0)
  await expect(layer(id, 'Trigger/Value')).toHaveText('Mecca')
  await leaveLiveMode()
})

test('a kit text input takes real typing and counts it', async () => {
  const id = await insertFromAssets('Text input')
  await startLiveMode()

  const input = island(id).getByRole('textbox')
  await expect(input).toHaveAttribute('placeholder', 'Email address')
  await input.click()
  await editor.page.keyboard.type('ali@example.com')
  await expect(input).toHaveValue('ali@example.com')
  await expect(layer(id, 'Counter')).toHaveText('15/60')
  await leaveLiveMode()
})

test('a kit modal opens over the canvas and closes from Cancel', async () => {
  const id = await insertFromAssets('Modal dialog')
  await startLiveMode()

  await island(id).locator('[data-layer=""]').click()
  const dialog = island(id).getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.locator('[data-layer="Actions/Cancel"]').click()
  await expect(dialog).toHaveCount(0)
  await leaveLiveMode()
})

test('a screen with a kit select runs live in the prototype player', async () => {
  const screenId = await editor.page.evaluate(() => {
    const store = window.lawha?.getStore?.()
    if (!store) throw new Error('Lawha store not initialized')
    const screen = store.graph.createNode('FRAME', store.state.currentPageId, {
      name: 'Checkout',
      x: -400,
      y: 0,
      width: 360,
      height: 480,
      fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1, visible: true }]
    })
    store.select([screen.id])
    return screen.id
  })
  const id = await insertFromAssets('Select')
  await editor.page.evaluate(
    ({ screen, select }) => {
      const store = window.lawha?.getStore?.()
      if (!store) throw new Error('Lawha store not initialized')
      store.graph.reparentNode(select, screen)
      store.graph.updateNode(select, { x: 40, y: 40 })
      store.select([screen])
      store.requestRender()
    },
    { screen: screenId, select: id }
  )
  await editor.page.getByTestId('prototype-present').click()
  const player = editor.page.getByTestId('prototype-player')
  await expect(player.getByTestId('prototype-live-screen')).toBeVisible()
  const live = player.locator(`[data-island="${screenId}"]`)
  await live.locator('[data-layer="Select/Trigger"]').click()
  await expect(live.locator('[data-layer="Select/Menu"]')).toBeVisible()
  await live.locator('[data-layer="Select/Menu/Option 3"]').click()
  await expect(live.locator('[data-layer="Select/Trigger/Value"]')).toHaveText('Dammam')
  await editor.page.getByTestId('prototype-close').click()
  await expect(player).toHaveCount(0)
})

test('kit controls draw on the canvas, left to right and right to left', async () => {
  // Earlier tests leave their controls on the page; this picture holds only its own.
  await editor.page.evaluate(() => {
    const store = window.lawha?.getStore?.()
    if (!store) throw new Error('Lawha store not initialized')
    for (const node of store.graph.getChildren(store.state.currentPageId))
      store.graph.deleteNode(node.id)
    store.requestRender()
  })
  await editor.page.getByTestId('left-panel-assets-tab').click()
  const kit = editor.page.getByTestId('assets-kit')
  const insert = async (name: string) => {
    const before = await editor.page.evaluate(
      () =>
        window.lawha?.getStore?.()?.graph.getChildren(window.lawha.getStore().state.currentPageId)
          .length ?? 0
    )
    await kit.getByRole('button', { name: `Insert ${name}`, exact: true }).click()
    await expect
      .poll(() =>
        editor.page.evaluate(
          () =>
            window.lawha
              ?.getStore?.()
              ?.graph.getChildren(window.lawha.getStore().state.currentPageId).length ?? 0
        )
      )
      .toBe(before + 1)
  }
  for (const name of ['Button', 'Toggle switch', 'Checkbox', 'Rating stars', 'Tabs'])
    await insert(name)
  const rtl = kit.getByRole('checkbox', { name: 'Right to left' })
  if ((await rtl.getAttribute('aria-checked')) !== 'true') await rtl.click()
  for (const name of ['Select', 'Tabs']) await insert(name)
  await editor.page.getByTestId('left-panel-layers-tab').click()
  // Lay them out in a column and fit the view.
  await editor.page.evaluate(() => {
    const store = window.lawha?.getStore?.()
    if (!store) throw new Error('Lawha store not initialized')
    let y = 0
    for (const node of store.graph.getChildren(store.state.currentPageId)) {
      store.graph.updateNode(node.id, { x: 0, y })
      y += node.height + 24
    }
    store.clearSelection()
    store.zoomToFit()
    store.requestRender()
  })
  await editor.canvas.waitForRender()
  expect(await editor.canvas.screenshotCanvas()).toMatchSnapshot('kit-controls.png')
})
