import { shallowRef } from 'vue'

import type { HistoryVersion } from '@lawha/core/history'

export type HistoryVersionInfo = { title: string; description: string }

/**
 * The version info dialog: saving the document as a named version, or naming or renaming one
 * already in the history. Whoever opens it says what saving does.
 */
export type HistoryVersionDialog = {
  version: HistoryVersion | null
  save: (info: HistoryVersionInfo) => Promise<void>
}

export const historyVersionDialog = shallowRef<HistoryVersionDialog | null>(null)

export function openHistoryVersionDialog(dialog: HistoryVersionDialog): void {
  historyVersionDialog.value = dialog
}
