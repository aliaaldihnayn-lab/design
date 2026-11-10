import { expect, test } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'

test('building the system adds Dark mode, text styles and component sets to the docs page', async ({
  page
}) => {
  await page.goto('/?test')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  await canvas.clearCanvas()
  await page.evaluate(() => {
    const store = window.lawha?.getStore?.()
    if (!store) throw new Error('Lawha store not initialized')
    const graph = store.graph
    const solid = (r: number, g: number, b: number) => [
      { type: 'SOLID' as const, color: { r, g, b, a: 1 }, opacity: 1, visible: true }
    ]
    const screen = graph.createNode('FRAME', store.state.currentPageId, {
      name: 'Home',
      width: 390,
      height: 700,
      fills: solid(1, 1, 1),
      layoutMode: 'VERTICAL',
      itemSpacing: 16
    })
    for (const size of [28, 16, 16, 12])
      graph.createNode('TEXT', screen.id, {
        name: `Text ${size}`,
        text: 'Hello',
        fontFamily: 'Inter',
        fontSize: size,
        fills: solid(0.07, 0.09, 0.15)
      })
    graph.createNode('FRAME', screen.id, {
      name: 'Button',
      width: 342,
      height: 52,
      cornerRadius: 12,
      fills: solid(0.05, 0.62, 0.43)
    })
    store.select([])
  })
  await page.getByTestId('design-system-build').click()

  const report = () =>
    page.evaluate(() => {
      const store = window.lawha?.getStore?.()
      if (!store) return null
      const graph = store.graph
      const docs = graph.getPages().find((p) => p.name === 'Design System')
      if (!docs) return null
      const children = graph.getChildren(docs.id)
      const collection = [...graph.variableCollections.values()][0]
      return {
        sections: children.filter((n) => !n.internalOnly).map((n) => n.name),
        styles: children.filter((n) => n.sharedStyleType === 'TEXT').map((n) => n.name),
        modes: collection?.modes.map((m) => m.name) ?? [],
        docs: docs.id
      }
    })
  await expect.poll(async () => (await report())?.sections ?? []).toContain('Badge')
  const built = await report()
  expect(built?.sections).toEqual([
    'Colors',
    'Typography',
    'Spacing & radius',
    'Colors · Dark',
    'Button',
    'Input',
    'Badge'
  ])
  expect(built?.styles.length).toBeGreaterThan(1)
  expect(built?.modes).toEqual(['Light', 'Dark'])

  // The docs page draws: go there and look at it whole.
  await page.evaluate((id) => {
    const store = window.lawha?.getStore?.()
    if (!store || !id) return
    void store.switchPage(id)
  }, built?.docs)
  await page.keyboard.press('Shift+1')
  await canvas.waitForRender()
  await page.waitForTimeout(4000)
  await page
    .getByTestId('canvas-area')
    .screenshot({ path: test.info().outputPath('design-system-page.png') })
})
