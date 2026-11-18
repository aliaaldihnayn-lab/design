import { invoke } from '@tauri-apps/api/core'
import { computed, watch } from 'vue'

import { useMenuMessages } from '@lawha/vue/i18n'

import { isTauri } from '@/app/tauri/env'

import { APP_MENU_LABEL_KEYS, type MenuMessageKey } from './labels'
import { APP_MENU_SCHEMA, type AppMenuEntry } from './schema'

type MenuMessages = ReturnType<typeof useMenuMessages>['value']

function entryLabels(
  entries: readonly AppMenuEntry[],
  messages: MenuMessages,
  labels: Record<string, string>
) {
  for (const entry of entries) {
    if (entry.type === 'separator') continue
    const key = APP_MENU_LABEL_KEYS[entry.id]
    if (key) labels[entry.id] = messages[key]
    if (entry.sub) entryLabels(entry.sub, messages, labels)
  }
}

function isMenuMessageKey(key: string, messages: MenuMessages): key is MenuMessageKey {
  return key in messages
}

/**
 * The desktop menu's labels in the app's language: every schema item with a `menu` message by
 * its id, each top menu as `group:<English label>`, and the macOS application menu's own items,
 * native-only ones such as About, Quit and Developer Tools included. The menu keeps the
 * schema's English for anything left out (`set_native_menu_labels` in `desktop/src/menu`).
 */
export function nativeMenuLabels(messages: MenuMessages): Record<string, string> {
  const labels: Record<string, string> = {}
  for (const group of APP_MENU_SCHEMA) {
    const groupKey = group.label.toLowerCase()
    if (isMenuMessageKey(groupKey, messages)) labels[`group:${group.label}`] = messages[groupKey]
    entryLabels(group.items, messages, labels)
  }
  for (const [id, key] of Object.entries(APP_MENU_LABEL_KEYS)) {
    if (key && !(id in labels)) {
      labels[id] = messages[key]
    }
  }
  return labels
}

/** Names the desktop menu in the app's language now and whenever the language changes. */
export function watchNativeMenuLabels(): () => void {
  const messages = useMenuMessages()
  const labels = computed(() => nativeMenuLabels(messages.value))
  return watch(
    labels,
    (next) => {
      if (!isTauri()) return
      invoke('set_native_menu_labels', { labels: next }).catch((error: unknown) => {
        console.warn('[Menu] Failed to name the native menu', error)
      })
    },
    { immediate: true }
  )
}
