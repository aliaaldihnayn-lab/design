import type { HistoryState } from '@lawha/core/history'

/** Where version history is kept on this device, by document key. */
export interface HistoryPersistence {
  read(key: string): Promise<HistoryState | null>
  write(key: string, state: HistoryState): Promise<void>
  remove(key: string): Promise<void>
}
