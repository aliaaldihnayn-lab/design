import type { Page } from '@playwright/test'

import { expect, test, useEditorSetup } from '#tests/e2e/fixtures'
import { CanvasHelper } from '#tests/helpers/canvas'
import { openPropertiesTab, type PropertiesPanelTab } from '#tests/helpers/properties'

const editor = useEditorSetup()

const SECTION_TABS = ['design', 'prototype', 'adapt', 'system', 'export'] as const

type Layer = 'rectangle' | 'frame' | 'text' | 'component'

/** Draws one layer of each kind and returns their ids. */
async function drawLayers(page: Page): Promise<Record<Layer, string>> {
  return page.evaluate(() => {
    const store = window.lawha?.getStore?.()
    if (!store) throw new Error('Lawha store not initialized')
    const component = store.createShape('COMPONENT', 320, 360, 200, 120)
    return {
      rectangle: store.createShape('RECTANGLE', 80, 80, 160, 100),
      frame: store.createShape('FRAME', 320, 80, 300, 220),
      text: store.createShape('TEXT', 80, 360, 200, 40),
      component
    }
  })
}

async function select(page: Page, id: string | null) {
  await page.evaluate((nodeId) => {
    const store = window.lawha?.getStore?.()
    if (!store) throw new Error('Lawha store not initialized')
    if (nodeId) store.select([nodeId])
    else store.clearSelection()
  }, id)
}

function panel(page: Page) {
  return page.getByTestId('properties-panel')
}

/** The tabs the row and its More menu offer, in order. */
async function offeredTabs(page: Page): Promise<string[]> {
  const inline = await panel(page)
    .getByRole('tab')
    .evaluateAll((tabs) =>
      tabs.flatMap((tab) => {
        const id = tab.getAttribute('data-test-id')?.replace('properties-tab-', '')
        return id ? [id] : []
      })
    )
  const more = panel(page).getByTestId('properties-tab-more')
  if ((await more.count()) === 0) return inline.filter((id) => !id.startsWith('dev-'))
  await more.click()
  const overflow = await page
    .getByRole('menuitem')
    .evaluateAll((items) =>
      items.flatMap(
        (item) => item.getAttribute('data-test-id')?.replace('properties-tab-', '') ?? []
      )
    )
  await page.keyboard.press('Escape')
  return [...inline.filter((id) => !id.startsWith('dev-')), ...overflow]
}

/** The sections a tab draws, by their section ids. */
async function tabSections(page: Page, tab: PropertiesPanelTab): Promise<string[]> {
  await openPropertiesTab(page, tab)
  return page
    .getByTestId(`properties-content-${tab}`)
    .locator('[data-panel-section]')
    .evaluateAll((sections) =>
      sections.map((section) => section.getAttribute('data-panel-section') ?? '')
    )
}

/** Every section tab's sections, checking that no section is drawn by two tabs. */
async function sectionsPerTab(page: Page) {
  const offered = await offeredTabs(page)
  const byTab: Partial<Record<PropertiesPanelTab, string[]>> = {}
  const owner = new Map<string, string>()
  for (const tab of SECTION_TABS) {
    if (!offered.includes(tab)) continue
    const sections = await tabSections(page, tab)
    for (const id of sections) {
      expect(owner.get(id), `${id} drawn by ${owner.get(id)} and ${tab}`).toBeUndefined()
      owner.set(id, tab)
    }
    byTab[tab] = sections
  }
  await openPropertiesTab(page, 'design')
  return { offered, byTab }
}

async function widenPanel(page: Page, by: number) {
  const handle = page.getByTestId('right-splitter-handle')
  const box = await handle.boundingBox()
  if (!box) throw new Error('Right splitter has no box')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 - by, box.y + box.height / 2, { steps: 8 })
  await page.mouse.up()
}

let layers: Record<Layer, string>

test.beforeAll(async () => {
  await editor.page.setViewportSize({ width: 1440, height: 900 })
  await editor.canvas.clearCanvas()
  layers = await drawLayers(editor.page)
  // Wide enough for every tab, so the row needs no More menu.
  await widenPanel(editor.page, 200)
})

test('with nothing selected the page, variables, prototype, system, and export split by tab', async () => {
  await select(editor.page, null)
  const { offered, byTab } = await sectionsPerTab(editor.page)
  expect(offered).toEqual(['design', 'prototype', 'system', 'export', 'dev', 'stories', 'ai'])
  expect(byTab.design).toEqual(expect.arrayContaining(['page', 'statuses', 'document']))
  expect(byTab.design).not.toContain('variables')
  expect(byTab.system).toEqual(['variables', 'designSystem'])
  expect(byTab.prototype).toEqual(['prototype'])
  expect(byTab.export).toEqual(['export'])
})

test('a rectangle keeps its layer sections in Design and offers no Adapt tab', async () => {
  await select(editor.page, layers.rectangle)
  const { offered, byTab } = await sectionsPerTab(editor.page)
  expect(offered).not.toContain('adapt')
  expect(byTab.design).toEqual(
    expect.arrayContaining(['header', 'position', 'appearance', 'fill', 'stroke', 'effects'])
  )
  for (const moved of ['prototype', 'designSystem', 'export', 'adapt'])
    expect(byTab.design).not.toContain(moved)
  expect(byTab.prototype).toEqual(['prototype'])
  expect(byTab.system).toEqual(['designSystem'])
  expect(byTab.export).toEqual(['export'])
})

test('a frame offers Adapt with its presets, screens, social sizes, and die-cut', async () => {
  await select(editor.page, layers.frame)
  const { offered, byTab } = await sectionsPerTab(editor.page)
  expect(offered).toEqual([
    'design',
    'prototype',
    'adapt',
    'system',
    'export',
    'dev',
    'stories',
    'ai'
  ])
  expect(byTab.adapt).toEqual(['framePreset', 'adapt'])
  expect(byTab.design).toEqual(expect.arrayContaining(['layout', 'layoutGuides']))
  await openPropertiesTab(editor.page, 'adapt')
  const adapt = editor.page.getByTestId('properties-content-adapt')
  for (const control of [
    'adapt-to-screens',
    'adapt-to-social',
    'print-product',
    'convert-to-dieline'
  ])
    await expect(adapt.getByTestId(control)).toBeVisible()
  await expect(adapt.locator('[data-property="frame-preset"]')).toBeVisible()
})

test('text keeps its content and typography in Design', async () => {
  await select(editor.page, layers.text)
  const { offered, byTab } = await sectionsPerTab(editor.page)
  expect(offered).not.toContain('adapt')
  expect(byTab.design).toEqual(expect.arrayContaining(['textContent', 'typography']))
})

test('a component adapts, and keeps its component sections in Design', async () => {
  await select(editor.page, layers.component)
  const { offered, byTab } = await sectionsPerTab(editor.page)
  expect(offered).toContain('adapt')
  expect(byTab.adapt).toEqual(['adapt'])
  expect(byTab.design).toEqual(expect.arrayContaining(['header', 'behaviours']))
})

test('several layers offer only Design, Export, and the panels', async () => {
  await editor.page.evaluate(
    (ids) => {
      window.lawha?.getStore?.()?.select(ids)
    },
    [layers.rectangle, layers.text]
  )
  const { offered, byTab } = await sectionsPerTab(editor.page)
  expect(offered).toEqual(['design', 'export', 'dev', 'stories', 'ai'])
  expect(byTab.export).toEqual(['export'])
})

test('a tab that stops applying falls back to Design, and comes back with its selection', async () => {
  await select(editor.page, layers.frame)
  await openPropertiesTab(editor.page, 'adapt')
  await select(editor.page, layers.rectangle)
  await expect(panel(editor.page).getByTestId('properties-tab-design')).toHaveAttribute(
    'aria-selected',
    'true'
  )
  await expect(panel(editor.page).getByTestId('properties-tab-adapt')).toHaveCount(0)
  await select(editor.page, layers.frame)
  await expect(panel(editor.page).getByTestId('properties-tab-adapt')).toHaveAttribute(
    'aria-selected',
    'true'
  )
})

test('only the active tab shows its label; the others name themselves in a tooltip', async () => {
  await select(editor.page, layers.frame)
  await openPropertiesTab(editor.page, 'design')
  const design = panel(editor.page).getByTestId('properties-tab-design')
  const prototype = panel(editor.page).getByTestId('properties-tab-prototype')
  await expect(design.getByText('Design', { exact: true })).toBeVisible()
  await expect(prototype).toHaveAccessibleName('Prototype')
  await expect(prototype.getByText('Prototype', { exact: true })).not.toBeInViewport()
  await prototype.hover()
  await expect(editor.page.getByRole('tooltip')).toHaveText('Prototype')
})

test('the chosen tab is remembered after a reload', async ({ page }) => {
  // A page of its own, with nothing drawn, so the reload offers no recovery.
  await page.goto('/?test')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  await openPropertiesTab(page, 'export')
  await page.reload()
  await canvas.waitForInit()
  await expect(panel(page).getByTestId('properties-tab-export')).toHaveAttribute(
    'aria-selected',
    'true'
  )
})

test('the Dev tab holds Inspect, Code, and Lint', async () => {
  await openPropertiesTab(editor.page, 'dev')
  const views = editor.page.getByTestId('properties-content-dev').getByRole('tab')
  await expect(views).toHaveCount(3)
  await editor.page.getByTestId('dev-tab-code').click()
  await expect(editor.page.getByTestId('code-panel-root')).toBeVisible()
  await editor.page.getByTestId('dev-tab-lint').click()
  await expect(editor.page.getByTestId('dev-tab-lint')).toHaveAttribute('aria-selected', 'true')
  await editor.page.getByTestId('dev-tab-inspect').click()
  await expect(editor.page.getByTestId('inspect-panel')).toBeVisible()
  await openPropertiesTab(editor.page, 'design')
})

test('the AI shortcut still toggles the AI tab', async () => {
  await editor.page.keyboard.press('ControlOrMeta+j')
  const ai = panel(editor.page).getByTestId('properties-tab-ai')
  await expect(ai).toHaveAttribute('aria-selected', 'true')
  await editor.page.keyboard.press('ControlOrMeta+j')
  await expect(panel(editor.page).getByTestId('properties-tab-design')).toHaveAttribute(
    'aria-selected',
    'true'
  )
})

test('a narrow panel moves the last tabs into More, which opens them', async () => {
  await select(editor.page, layers.frame)
  await openPropertiesTab(editor.page, 'design')
  await widenPanel(editor.page, -400)
  const more = panel(editor.page).getByTestId('properties-tab-more')
  await expect(more).toBeVisible()
  await more.click()
  const ai = editor.page.getByRole('menuitem').and(editor.page.getByTestId('properties-tab-ai'))
  await ai.click()
  await expect(panel(editor.page).getByTestId('properties-tab-ai')).toHaveAttribute(
    'aria-selected',
    'true'
  )
  // The active tab always stays in the row.
  await expect(panel(editor.page).getByRole('tab', { name: 'AI' })).toBeVisible()
  await openPropertiesTab(editor.page, 'design')
  await widenPanel(editor.page, 400)
})
