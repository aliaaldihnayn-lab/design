import { expect, test } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'

test('the Inspect tab shows the selected layer’s properties and its CSS, SwiftUI, UIKit, Compose and Android XML', async ({
  page
}) => {
  await page.goto('/?test')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  await canvas.clearCanvas()
  await page.getByTestId('properties-tab-inspect').click()
  await expect(page.getByTestId('inspect-panel')).toBeVisible()
  await expect(page.getByTestId('inspect-code')).toHaveCount(0)

  await page.evaluate(() => {
    const store = window.lawha?.getStore?.()
    if (!store) throw new Error('Lawha store not initialized')
    const card = store.graph.createNode('FRAME', store.state.currentPageId, {
      name: 'Card',
      width: 320,
      height: 200,
      cornerRadius: 12,
      minWidth: 240,
      layoutMode: 'VERTICAL',
      itemSpacing: 12,
      fills: [
        { type: 'SOLID', color: { r: 0.31, g: 0.27, b: 0.9, a: 1 }, opacity: 1, visible: true }
      ]
    })
    store.select([card.id])
  })

  const code = page.getByTestId('inspect-code')
  await expect(code).toContainText('width: 320px;')
  await expect(code).toContainText('min-width: 240px;')
  await expect(code).toContainText('border-radius: 12px;')
  await expect(page.getByTestId('inspect-color')).toHaveCount(1)

  await page.getByTestId('inspect-language').getByText('SwiftUI', { exact: true }).click()
  await expect(code).toContainText('VStack(alignment: .leading, spacing: 12)')
  await page.getByTestId('inspect-language').getByText('Compose', { exact: true }).click()
  await expect(code).toContainText('Column(')
  await expect(code).toContainText('RoundedCornerShape(12.dp)')
  await page.getByTestId('inspect-language').getByText('UIKit', { exact: true }).click()
  await expect(code).toContainText('let card = UIStackView()')
  await page.getByTestId('inspect-language').getByText('Android XML', { exact: true }).click()
  await expect(code).toContainText('<LinearLayout')
  await page.getByTestId('inspect-language').getByText('Compose', { exact: true }).click()

  // An edit shows at once.
  await page.evaluate(() => {
    const store = window.lawha?.getStore?.()
    if (!store) return
    const [id] = store.state.selectedIds
    store.graph.updateNode(id, { cornerRadius: 20 })
    store.requestRender()
  })
  await expect(code).toContainText('RoundedCornerShape(20.dp)')
  await page
    .getByTestId('properties-panel')
    .screenshot({ path: test.info().outputPath('inspect-panel.png') })
})
