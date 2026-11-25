import { expect, test } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'
import { cloudHomeStorage } from '#tests/helpers/cloud/ai'
import { routeCloudJira } from '#tests/helpers/cloud/jira'

// On the web, Jira is reached through a Lawha Cloud server, which a build without Cloud lacks.
test.skip(process.env.VITE_LAWHA_CLOUD !== 'on', 'Needs a build with Lawha Cloud')
test.describe.configure({ timeout: 60_000 })

test.use({
  storageState: async ({ baseURL }, use) => {
    if (!baseURL) throw new Error('Browser test baseURL is required')
    await use({
      cookies: [],
      origins: [
        {
          origin: new URL(baseURL).origin,
          localStorage: [
            {
              name: 'lawha:preferences:v1',
              value: JSON.stringify({ version: 1, onboarding: { aiSetup: 'done' } })
            },
            cloudHomeStorage()
          ]
        }
      ]
    })
  }
})

test('stories become Jira issues, show their status on the pin, and say why a sync failed', async ({
  page,
  baseURL
}) => {
  const jira = await routeCloudJira(page, new URL(baseURL ?? '').origin)
  await page.goto('/?test')
  await new CanvasHelper(page).waitForInit()
  const frameId = await page.evaluate(() => {
    const store = window.lawha?.getStore?.()
    if (!store) throw new Error('Lawha store not initialized')
    const frame = store.graph.createNode('FRAME', store.state.currentPageId, {
      name: 'الدفع',
      x: 100,
      y: 100,
      width: 300,
      height: 400
    })
    const epic = store.addEpic({ title: 'المدفوعات' })
    store.addUserStory(frame.id, { title: 'ادفع للطلب', epicId: epic.id })
    store.select([frame.id])
    return frame.id
  })

  await page.getByTestId('properties-tab-stories').click()
  const panel = page.getByTestId('stories-panel')
  const row = panel.locator('[data-slot="jira"]')
  await row.getByRole('button', { name: 'Jira project' }).click()
  await page.getByRole('option', { name: /SHOP/ }).click()
  await row.locator('[data-action="push-jira"]').click()

  // The Epic first, then the Story under it through parent, in the team-managed project's types.
  await expect(panel.locator('[data-slot="story"]')).toContainText('SHOP-2')
  const created = jira.forwarded.filter((call) => call.path === '/rest/api/3/issue')
  expect(created.map((call) => call.body)).toEqual([
    { fields: expect.objectContaining({ issuetype: { id: '10121' }, summary: 'المدفوعات' }) },
    {
      fields: expect.objectContaining({ issuetype: { id: '10120' }, parent: { key: 'SHOP-1' } })
    }
  ])

  const story = jira.issues.get('SHOP-2')
  if (!story) throw new Error('The story was not created')
  story.status = { name: 'قيد التنفيذ', category: 'indeterminate' }
  story.assignee = 'عمر'
  await row.locator('[data-action="pull-jira"]').click()
  const pin = page.locator(`[data-slot="story-pin"][data-node-id="${frameId}"]`)
  await expect(pin.locator('[data-category]')).toHaveAttribute('data-category', 'indeterminate')
  await expect(pin).toContainText('قيد التنفيذ')

  // A refused sync replaces the last one's counts with why it failed.
  const status = row.getByRole('status')
  await expect(status).toBeVisible()
  jira.fail(/search\/jql/, 429)
  await row.locator('[data-action="pull-jira"]').click()
  await expect(row.getByRole('alert')).toBeVisible()
  await expect(status).toHaveCount(0)
  expect(jira.unexpected).toEqual([])
})
