import { useSessionStorage } from '@vueuse/core'
import * as v from 'valibot'

import { DEV_VIEWS, PROPERTIES_TABS, type DevView, type PropertiesTab } from './tabs'

const TAB_STORAGE_KEY = 'lawha:properties-tab'
const DEV_VIEW_STORAGE_KEY = 'lawha:properties-dev-view'

function storedChoice<T extends string>(key: string, values: readonly [T, ...T[]], fallback: T) {
  const choiceSchema = v.picklist(values)
  return useSessionStorage<T>(key, fallback, {
    serializer: {
      read: (raw) => {
        const parsed = v.safeParse(choiceSchema, raw)
        return parsed.success ? parsed.output : fallback
      },
      write: (value) => value
    }
  })
}

/**
 * The tab last chosen in the properties panel, kept for the browser session. The panel shows it
 * while the selection offers it and Design otherwise, so choosing Adapt for one frame shows Adapt
 * again for the next frame.
 */
export const propertiesTab = storedChoice<PropertiesTab>(
  TAB_STORAGE_KEY,
  [...PROPERTIES_TABS],
  'design'
)

/** The Dev tab's view last chosen: Inspect, Code, or Lint. */
export const devView = storedChoice<DevView>(DEV_VIEW_STORAGE_KEY, [...DEV_VIEWS], 'inspect')

export function showPropertiesTab(tab: PropertiesTab): void {
  propertiesTab.value = tab
}

/** Opens the Dev tab on one of its views, as the old Inspect, Code, and Lint tabs opened. */
export function showDevView(view: DevView): void {
  devView.value = view
  propertiesTab.value = 'dev'
}
