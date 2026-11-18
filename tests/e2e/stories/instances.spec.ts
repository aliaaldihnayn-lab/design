import { expect, test } from '#tests/e2e/fixtures'
import { CanvasHelper } from '#tests/helpers/canvas'

// The editor's first load after a dependency change can take a while.
test.describe.configure({ timeout: 60_000 })

test('an instance offers its main component stories and copies them only when asked', async ({
  page
}) => {
  await page.goto('/?test')
  await new CanvasHelper(page).waitForInit()
  const instanceId = await page.evaluate(() => {
    const store = window.lawha?.getStore?.()
    if (!store) throw new Error('Lawha store not initialized')
    const pageId = store.state.currentPageId
    const component = store.graph.createNode('COMPONENT', pageId, {
      name: 'Button',
      width: 120,
      height: 40
    })
    store.addUserStory(component.id, { title: 'Press the button' })
    const instance = store.graph.createInstance(component.id, pageId, { x: 200 })
    if (!instance) throw new Error('No instance')
    store.select([instance.id])
    return instance.id
  })

  await page.getByTestId('properties-tab-stories').click()
  const panel = page.getByTestId('stories-panel')
  await expect(panel.locator('[data-slot="layer-stories"]')).toContainText('No user stories')
  const copy = panel.locator('[data-action="copy-main-stories"]')
  await expect(copy).toBeVisible()
  await copy.click()
  await expect(copy).toHaveCount(0)
  const titles = await page.evaluate((id) => {
    const store = window.lawha?.getStore?.()
    const node = store?.graph.getNode(id)
    const entry = node?.pluginData.find((item) => item.key === 'userStories')
    return entry?.value ?? ''
  }, instanceId)
  expect(titles).toContain('Press the button')
})
