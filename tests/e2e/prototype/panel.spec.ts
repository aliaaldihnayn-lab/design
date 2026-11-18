import { expect, test, type Page } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'

/** A screen with a button and a label, and two variables a prototype can use. */
async function open(page: Page) {
  await page.goto('/?test')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  await canvas.clearCanvas()
  return page.evaluate(() => {
    const store = window.lawha?.getStore?.()
    if (!store) throw new Error('Lawha store not initialized')
    const graph = store.graph
    const pageId = store.state.currentPageId
    const screen = graph.createNode('FRAME', pageId, { name: 'Home', width: 390, height: 844 })
    graph.createNode('FRAME', pageId, { name: 'Done', x: 500, width: 390, height: 844 })
    const button = graph.createNode('FRAME', screen.id, {
      name: 'Button',
      x: 40,
      y: 700,
      width: 310,
      height: 56
    })
    const label = graph.createNode('TEXT', screen.id, {
      name: 'Count label',
      text: '0',
      width: 100,
      height: 20
    })
    const collection = graph.createCollection('State')
    const count = graph.createVariable('count', 'FLOAT', collection.id, 0)
    graph.createVariable('agreed', 'BOOLEAN', collection.id, false)
    store.select([button.id])
    return { button: button.id, label: label.id, count: count.id }
  })
}

function interactionsOf(page: Page, id: string) {
  return page.evaluate((nodeId) => {
    const node = window.lawha?.getStore?.().graph.getNode(nodeId)
    return node?.pluginData.find((entry) => entry.key === 'prototype.interactions')?.value ?? ''
  }, id)
}

test('a conditional is built in the panel: comparisons, then and otherwise', async ({ page }) => {
  const ids = await open(page)
  await page.getByTestId('prototype-add').click()
  await page.getByTestId('prototype-action').first().click()
  await page.getByRole('option', { name: 'Conditional' }).click()
  const conditional = page.getByTestId('prototype-conditional')
  await expect(conditional).toBeVisible()
  await expect.poll(() => interactionsOf(page, ids.button)).toContain('"type":"conditional"')

  // count is at least 3.
  const condition = conditional.getByTestId('prototype-condition')
  await condition.getByRole('combobox', { name: 'Variable' }).click()
  await page.getByRole('option', { name: 'count' }).click()
  await condition.getByRole('combobox', { name: 'Comparison' }).click()
  await page.getByRole('option', { name: 'is at least' }).click()
  const value = condition.getByRole('spinbutton', { name: 'Value' })
  await value.fill('3')
  await value.press('Tab')
  await expect
    .poll(() => interactionsOf(page, ids.button))
    .toContain(`{"variable":"${ids.count}","op":"gte","value":3}`)

  // Otherwise runs an action of its own.
  await conditional.getByRole('button', { name: 'Add action' }).nth(1).click()
  await expect.poll(() => interactionsOf(page, ids.button)).toContain('"otherwise":[')
  await conditional.getByRole('button', { name: 'Add condition' }).click()
  await expect(conditional.getByTestId('prototype-condition')).toHaveCount(2)
})

test('the panel binds a text layer to a variable and an action to a per-instance scope', async ({
  page
}) => {
  const ids = await open(page)
  await page.evaluate((id) => window.lawha?.getStore?.().select([id]), ids.label)
  const bindings = page.getByTestId('prototype-bindings')
  await bindings.getByRole('combobox', { name: 'Text shows' }).click()
  await page.getByRole('option', { name: 'count' }).click()
  await expect
    .poll(() =>
      page.evaluate(
        (id) => window.lawha?.getStore?.().graph.getNode(id)?.boundVariables.text ?? '',
        ids.label
      )
    )
    .toBe(ids.count)

  // A Set variable can keep its variable per instance.
  await page.evaluate((id) => window.lawha?.getStore?.().select([id]), ids.button)
  await page.getByTestId('prototype-add').click()
  await page.getByTestId('prototype-action').first().click()
  await page.getByRole('option', { name: 'Set variable' }).click()
  await page.getByTestId('prototype-variable-scope').click()
  await expect
    .poll(() =>
      page.evaluate(() =>
        [...(window.lawha?.getStore?.().graph.variables.values() ?? [])]
          .filter((variable) =>
            variable.pluginData?.some((entry) => entry.key === 'prototype.scope')
          )
          .map((variable) => variable.name)
      )
    )
    .toEqual(['count'])
})
