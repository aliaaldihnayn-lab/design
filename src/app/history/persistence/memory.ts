import type { HistoryState } from '@lawha/core/history'

import type { HistoryPersistence } from './types'

/** History kept for the session only, as in tests and where no storage is available. */
export function createMemoryHistoryPersistence(): HistoryPersistence & {
  keys(): string[]
} {
  const states = new Map<string, HistoryState>()
  return {
    read: (key) =>
      Promise.resolve(states.has(key) ? structuredClone(states.get(key) ?? null) : null),
    write: (key, state) => {
      states.set(key, structuredClone(state))
      return Promise.resolve()
    },
    remove: (key) => {
      states.delete(key)
      return Promise.resolve()
    },
    keys: () => [...states.keys()]
  }
}
