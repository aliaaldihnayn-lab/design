import { expect, test, type CDPSession, type Page } from '@playwright/test'

import { expectDefined } from '#tests/helpers/assert'
import { CanvasHelper } from '#tests/helpers/canvas'

test.use({ hasTouch: true })

interface Point {
  x: number
  y: number
}

function touch(session: CDPSession, type: 'touchStart' | 'touchMove' | 'touchEnd', at: Point[]) {
  return session.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: at.map((point, id) => ({ ...point, id }))
  })
}

function scene(page: Page) {
  return page.evaluate(() => {
    const store = window.lawha?.getStore?.()
    if (!store) throw new Error('Lawha store not initialized')
    return {
      zoom: store.state.zoom,
      tool: store.state.activeTool,
      selected: [...store.state.selectedIds],
      layers: store.graph.getChildren(store.state.currentPageId).map((node) => node.id)
    }
  })
}

// Two fingers never land at once: the first finger's press must not select, draw, or move
// anything once the second one turns the touch into a pinch.
for (const tool of ['SELECT', 'RECTANGLE'] as const) {
  test(`a pinch that starts on a layer only zooms (${tool} tool)`, async ({ page }) => {
    await page.goto('/?test&no-chrome&no-rulers')
    const canvas = new CanvasHelper(page)
    await canvas.waitForInit()
    const layer = await page.evaluate((tool) => {
      const store = window.lawha?.getStore?.()
      if (!store) throw new Error('Lawha store not initialized')
      const id = store.createShape('RECTANGLE', 300, 300, 100, 80)
      store.clearSelection()
      store.setTool(tool)
      return id
    }, tool)
    const box = expectDefined(await canvas.canvas.boundingBox(), 'canvas bounds')
    const session = await page.context().newCDPSession(page)
    // The first finger lands on the layer, at canvas point 350, 340.
    const first = { x: box.x + 350, y: box.y + 340 }
    const second = { x: first.x + 100, y: first.y }
    await touch(session, 'touchStart', [first])
    await touch(session, 'touchStart', [first, second])
    for (let step = 1; step <= 10; step++) {
      await touch(session, 'touchMove', [
        { x: first.x - 5 * step, y: first.y },
        { x: second.x + 5 * step, y: second.y }
      ])
    }
    await touch(session, 'touchEnd', [])
    await canvas.waitForRender()

    const after = await scene(page)
    expect(after.zoom).toBeCloseTo(2, 5)
    expect(after).toMatchObject({ tool, selected: [], layers: [layer] })
    canvas.assertNoErrors()
  })
}
