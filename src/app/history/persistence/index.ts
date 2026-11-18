import { IS_TAURI } from '@/constants'

import { createIdbHistoryPersistence } from './idb'
import { createMemoryHistoryPersistence } from './memory'
import { createTauriHistoryPersistence } from './tauri'
import type { HistoryPersistence } from './types'

export type { HistoryPersistence } from './types'
export { createMemoryHistoryPersistence } from './memory'

let persistence: HistoryPersistence | null = null

/** Files on the desktop app, IndexedDB in a browser, memory where neither exists. */
export function getHistoryPersistence(): HistoryPersistence {
  if (persistence) return persistence
  if (IS_TAURI) persistence = createTauriHistoryPersistence()
  else if ('indexedDB' in globalThis) persistence = createIdbHistoryPersistence()
  else persistence = createMemoryHistoryPersistence()
  return persistence
}
