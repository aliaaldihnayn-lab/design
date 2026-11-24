import type { Locator, Page } from '@playwright/test'

export function propertySection(page: Page, name: string): Locator {
  return page.getByRole('region', { name, exact: true })
}

/** The Design panel's header for the selected layer, found by the layer's name. */
export function layerHeader(page: Page, name: string): Locator {
  return page.locator('header').filter({ has: page.getByRole('heading', { name, exact: true }) })
}

export function propertyField(page: Page, property: string): Locator {
  return page.locator(`[data-property=${JSON.stringify(property)}]`)
}

export function propertyItems(page: Page, property: string): Locator {
  return page.locator(`[data-property=${JSON.stringify(property)}][data-index]`)
}

export function propertyItem(page: Page, property: string, index = 0): Locator {
  return page.locator(
    `[data-property=${JSON.stringify(property)}][data-index=${JSON.stringify(String(index))}]`
  )
}

export type PropertiesPanelTab =
  | 'design'
  | 'prototype'
  | 'adapt'
  | 'system'
  | 'export'
  | 'dev'
  | 'stories'
  | 'ai'

/** Opens a properties panel tab, through the More menu when the row has no room for it. */
export async function openPropertiesTab(page: Page, tab: PropertiesPanelTab): Promise<void> {
  const panel = page.getByTestId('properties-panel')
  const trigger = panel.getByTestId(`properties-tab-${tab}`)
  if ((await trigger.count()) === 0) {
    await panel.getByTestId('properties-tab-more').click()
    await page
      .getByRole('menuitem')
      .and(page.getByTestId(`properties-tab-${tab}`))
      .click()
  } else {
    await trigger.click()
  }
  await page.getByTestId(`properties-content-${tab}`).waitFor({ state: 'visible' })
}

/** Opens one of the Dev tab's views: Inspect, Code, or Lint. */
export async function openDevView(page: Page, view: 'inspect' | 'code' | 'lint'): Promise<void> {
  await openPropertiesTab(page, 'dev')
  await page.getByTestId(`dev-tab-${view}`).click()
}
