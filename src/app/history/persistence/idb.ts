import type { DBSchema } from 'idb'
import * as v from 'valibot'

import { historyStateSchema, type HistoryState } from '@lawha/core/history'

import { APP_DATABASE_NAMES, connectAppDatabase, defineAppDatabase } from '@/app/storage/idb'

import type { HistoryPersistence } from './types'

interface HistoryRow {
  key: string
  updatedAt: string
  /** The history as JSON text: one string row rather than thousands of nested objects. */
  state: string
}

interface HistoryDatabase extends DBSchema {
  histories: { key: string; value: HistoryRow }
}

const historyDatabase = defineAppDatabase<HistoryDatabase>({
  name: APP_DATABASE_NAMES.history,
  version: 1,
  callbacks: {
    upgrade(database) {
      if (!database.objectStoreNames.contains('histories')) {
        database.createObjectStore('histories', { keyPath: 'key' })
      }
    }
  }
})

const storedStateSchema = v.pipe(v.string(), v.parseJson(), historyStateSchema)

export function createIdbHistoryPersistence(): HistoryPersistence {
  const database = connectAppDatabase(historyDatabase)
  return {
    async read(key) {
      const row = await (await database.open()).get('histories', key)
      if (!row) return null
      const parsed = v.safeParse(storedStateSchema, row.state)
      return parsed.success ? parsed.output : null
    },
    async write(key, state: HistoryState) {
      const row: HistoryRow = {
        key,
        updatedAt: new Date().toISOString(),
        state: JSON.stringify(state)
      }
      await (await database.open()).put('histories', row)
    },
    async remove(key) {
      await (await database.open()).delete('histories', key)
    }
  }
}
