import type { Editor } from '@lawha/core'
import type { MenuEntry } from '@lawha/vue/editor/menu-model'
import { pageMessages } from '@lawha/vue/i18n'

/**
 * Affinity Publisher's commands for the selection: master pages for selected page frames, a page
 * number for a page or master, and linking or unlinking text frames.
 */
export function publisherMenuEntries(editor: Editor): MenuEntry[] {
  const state = editor.publicationSelection()
  const t = pageMessages.get()
  const entries: MenuEntry[] = []
  if (state.pages === 1)
    entries.push({
      label: t.newMasterPage,
      testId: 'context-new-master-page',
      action: () => editor.createMasterPage()
    })
  if (state.pages > 0) {
    for (const master of state.masters) {
      entries.push({
        label: t.applyMasterPage({ name: master.name }),
        testId: 'context-apply-master-page',
        action: () => editor.applyMasterPage(master.id)
      })
    }
    if (state.pagesWithMaster > 0) {
      entries.push({
        label: t.removeMasterPage,
        testId: 'context-remove-master-page',
        action: () => editor.removeMasterPage()
      })
      entries.push({
        label: t.detachFromMaster,
        testId: 'context-detach-from-master',
        action: () => editor.detachFromMasterPage()
      })
    }
  }
  if (state.frame)
    entries.push({
      label: t.convertToMasterPage,
      testId: 'context-convert-to-master-page',
      action: () => editor.convertToMasterPage()
    })
  if (state.pages === 1 || state.master)
    entries.push({
      label: t.insertPageNumber,
      testId: 'context-insert-page-number',
      action: () => editor.insertPageNumber()
    })
  if (state.texts >= 2)
    entries.push({
      label: t.linkTextFrames,
      testId: 'context-link-text-frames',
      action: () => editor.linkTextFrames()
    })
  if (state.threaded > 0)
    entries.push({
      label: t.unlinkTextFrame,
      testId: 'context-unlink-text-frame',
      action: () => editor.unlinkTextFrame()
    })
  return entries.length > 0 ? [{ separator: true }, ...entries] : []
}
