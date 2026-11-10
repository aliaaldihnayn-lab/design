import { expect, test, type Page } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'

interface Ids {
  a: string
  b: string
  card: string
  list: string
  item: string
}

/** Screen A with a small card and a scrolling list; screen B with the card grown and moved. */
async function build(page: Page): Promise<Ids> {
  await page.goto('/?test')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  await canvas.clearCanvas()
  return page.evaluate(() => {
    const store = window.lawha?.getStore?.()
    if (!store) throw new Error('Lawha store not initialized')
    const graph = store.graph
    const pageId = store.state.currentPageId
    const solid = (r: number, g: number, b: number) => [
      { type: 'SOLID' as const, color: { r, g, b, a: 1 }, opacity: 1, visible: true }
    ]
    const a = graph.createNode('FRAME', pageId, {
      name: 'A',
      x: 0,
      width: 390,
      height: 844,
      fills: solid(1, 1, 1),
      clipsContent: true
    })
    const b = graph.createNode('FRAME', pageId, {
      name: 'B',
      x: 600,
      width: 390,
      height: 844,
      fills: solid(0.95, 0.95, 1),
      clipsContent: true
    })
    const card = graph.createNode('FRAME', a.id, {
      name: 'Card',
      x: 20,
      y: 40,
      width: 120,
      height: 80,
      cornerRadius: 12,
      fills: solid(0.9, 0.3, 0.2)
    })
    graph.createNode('FRAME', b.id, {
      name: 'Card',
      x: 0,
      y: 300,
      width: 390,
      height: 260,
      cornerRadius: 12,
      fills: solid(0.9, 0.3, 0.2)
    })
    const list = graph.createNode('FRAME', a.id, {
      name: 'List',
      x: 0,
      y: 200,
      width: 390,
      height: 400,
      clipsContent: true,
      fills: solid(0.9, 0.9, 0.9)
    })
    let item = ''
    for (let i = 0; i < 10; i++) {
      const row = graph.createNode('FRAME', list.id, {
        name: `Row ${i}`,
        x: 0,
        y: i * 100,
        width: 390,
        height: 90,
        fills: solid(0.2 + i * 0.07, 0.5, 0.8)
      })
      if (i === 8) item = row.id
    }
    const transition = {
      type: 'smart-animate',
      direction: 'left',
      duration: 1200,
      easing: 'linear'
    }
    const link = (destination: string) =>
      JSON.stringify([
        { trigger: { type: 'click' }, action: { type: 'navigate', destination, transition } }
      ])
    graph.updateNode(card.id, {
      pluginData: [{ pluginId: 'lawha', key: 'prototype.interactions', value: link(b.id) }]
    })
    graph.updateNode(item, {
      pluginData: [{ pluginId: 'lawha', key: 'prototype.interactions', value: link(b.id) }]
    })
    graph.updateNode(list.id, {
      pluginData: [{ pluginId: 'lawha', key: 'prototype.scroll', value: 'vertical' }]
    })
    store.select([a.id])
    return { a: a.id, b: b.id, card: card.id, list: list.id, item }
  })
}

test('Smart Animate moves the matched card from its place to the next screen’s', async ({
  page
}) => {
  const ids = await build(page)
  await page.getByTestId('prototype-present').click()
  const name = page.getByTestId('prototype-screen-name')
  await expect(name).toHaveText('A')
  await page.locator(`[data-hotspot="${ids.card}"]`).click()
  const smart = page.getByTestId('prototype-smart-animate')
  await expect(smart).toBeVisible()
  // One matched layer: its image on each screen, over the two screen backgrounds.
  await expect(smart.locator('[data-smart-out]')).toHaveCount(1)
  await expect(smart.locator('[data-smart-in]')).toHaveCount(1)
  await page.waitForTimeout(500)
  const stage = page.getByTestId('prototype-stage')
  await stage.screenshot({ path: test.info().outputPath('smart-animate-mid.png') })
  const transform = await smart
    .locator('[data-smart-out]')
    .evaluate((el) => getComputedStyle(el).transform)
  // Part way through, the card is scaled up between its two sizes.
  const scaleX = Number(/matrix\(([^,]+)/.exec(transform)?.[1])
  expect(scaleX).toBeGreaterThan(1.2)
  expect(scaleX).toBeLessThan(3.25)
  await expect(smart).toHaveCount(0)
  await expect(name).toHaveText('B')
})

test('a scrolling frame scrolls its content and its hotspots scroll with it', async ({ page }) => {
  const ids = await build(page)
  await page.getByTestId('prototype-present').click()
  const region = page.locator(`[data-scroll="${ids.list}"]`)
  await expect(region).toBeVisible()
  const sizes = await region.evaluate((el) => [el.scrollHeight, el.clientHeight])
  expect(sizes[0]).toBeGreaterThan(sizes[1] * 2)
  await region.evaluate((el) => el.scrollTo({ top: el.scrollHeight }))
  await page.locator(`[data-hotspot="${ids.item}"]`).click()
  await expect(page.getByTestId('prototype-screen-name')).toHaveText('B')
})

test('connections draw as noodles, and dragging the handle to a screen links it', async ({
  page
}) => {
  const ids = await build(page)
  await page.getByTestId('prototype-show-connections').click()
  const layer = page.getByTestId('prototype-connections')
  await expect(layer).toHaveAttribute('data-connections', '2')

  // A new layer on A, linked by dragging its handle onto B.
  const target = await page.evaluate(() => {
    const store = window.lawha?.getStore?.()
    if (!store) throw new Error('Lawha store not initialized')
    const screen = store.graph.getChildren(store.state.currentPageId)[0]
    const button = store.graph.createNode('FRAME', screen.id, {
      name: 'Next',
      x: 200,
      y: 140,
      width: 150,
      height: 48
    })
    store.select([button.id])
    store.requestRender()
    const other = store.graph.getChildren(store.state.currentPageId)[1]
    const { zoom, panX, panY } = store.state
    return {
      id: button.id,
      x: (other.x + other.width / 2) * zoom + panX,
      y: (other.y + other.height / 2) * zoom + panY
    }
  })
  const handle = page.getByTestId('prototype-connection-handle')
  await expect(handle).toBeVisible()
  const box = await handle.boundingBox()
  const canvasBox = await layer.boundingBox()
  if (!box || !canvasBox) throw new Error('no handle')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(canvasBox.x + target.x, canvasBox.y + target.y, { steps: 8 })
  await expect(layer).toHaveAttribute('data-drop-target', ids.b)
  await page.mouse.up()
  await expect(layer).toHaveAttribute('data-connections', '3')
  const saved = await page.evaluate((id) => {
    const node = window.lawha?.getStore?.().graph.getNode(id)
    return node?.pluginData.find((e) => e.key === 'prototype.interactions')?.value ?? ''
  }, target.id)
  expect(saved).toContain(ids.b)
})
