import { BaseDirectory, mkdir, readFile, remove, writeFile } from '@tauri-apps/plugin-fs'
import * as v from 'valibot'

import { hashHistoryText, historyStateSchema } from '@lawha/core/history'

import type { HistoryPersistence } from './types'

/** Each document's history is one JSON file under the app's local data folder. */
const HISTORY_DIR = 'history/v1'

const storedStateSchema = v.pipe(v.string(), v.parseJson(), historyStateSchema)
const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** A file name for a key, which may be a path or a URL and so cannot name a file itself. */
export function historyFileName(key: string): string {
  return `${HISTORY_DIR}/${hashHistoryText(key)}.json`
}

export function createTauriHistoryPersistence(): HistoryPersistence {
  const options = { baseDir: BaseDirectory.AppLocalData }
  return {
    async read(key) {
      let text: string
      try {
        text = decoder.decode(await readFile(historyFileName(key), options))
      } catch {
        return null
      }
      const parsed = v.safeParse(storedStateSchema, text)
      return parsed.success ? parsed.output : null
    },
    async write(key, state) {
      await mkdir(HISTORY_DIR, { ...options, recursive: true })
      await writeFile(historyFileName(key), encoder.encode(JSON.stringify(state)), options)
    },
    async remove(key) {
      try {
        await remove(historyFileName(key), options)
      } catch (error) {
        console.warn('[History] Removing kept history skipped:', error)
      }
    }
  }
}
