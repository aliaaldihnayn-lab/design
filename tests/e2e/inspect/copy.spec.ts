import { expect, test } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'

test.use({ permissions: ['clipboard-read', 'clipboard-write'] })

test('the Inspect tab names bound variables, shows gradients, and copies the code shown', async ({
  page
}) => {
  await page.goto('/?test')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  await canvas.clearCanvas()
  await page.getByTestId('properties-tab-inspect').click()

  await page.evaluate(() => {
    const store = window.lawha?.getStore?.()
    if (!store) throw new Error('Lawha store not initialized')
    const graph = store.graph
    const collection = graph.createCollection('Theme')
    const brand = graph.createVariable('color/brand', 'COLOR', collection.id, {
      r: 0.86,
      g: 0.15,
      b: 0.15,
      a: 1
    })
    const card = graph.createNode('FRAME', store.state.currentPageId, {
      name: 'Hero',
      width: 200,
      height: 100,
      rotation: 15,
      fills: [
        {
          type: 'GRADIENT_LINEAR',
          color: { r: 0, g: 0, b: 0, a: 1 },
          opacity: 1,
          visible: true,
          gradientTransform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
          gradientStops: [
            { color: { r: 1, g: 0, b: 0, a: 1 }, position: 0 },
            { color: { r: 0, g: 0, b: 1, a: 1 }, position: 1 }
          ]
        }
      ],
      strokes: [
        {
          type: 'SOLID',
          color: { r: 0.86, g: 0.15, b: 0.15, a: 1 },
          opacity: 1,
          visible: true,
          weight: 2,
          align: 'INSIDE'
        }
      ]
    })
    graph.bindVariable(card.id, 'strokes/0/color', brand.id)
    store.select([card.id])
  })

  const panel = page.getByTestId('inspect-panel')
  await expect(
    panel.getByRole('definition').filter({ hasText: 'linear-gradient(90deg' })
  ).toBeVisible()
  await expect(page.getByTestId('inspect-color')).toContainText('color/brand')

  const code = page.getByTestId('inspect-code')
  await page.getByTestId('inspect-language').getByText('SwiftUI', { exact: true }).click()
  await expect(code).toContainText('LinearGradient(')
  await expect(code).toContainText('.rotationEffect(.degrees(15))')
  await page.getByTestId('inspect-copy').click()
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(await code.innerText())
})
