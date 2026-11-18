import { isCloudBinding, openVersionDialog, openVersionHistory } from '@/app/cloud/integration'
import { getActiveEditorStore, type EditorStore } from '@/app/editor/active-store'
import { openLocalHistory, openLocalVersionDialog } from '@/app/history/panel'
import { openSaveTo } from '@/app/storage/save-to/session'
import { showsDocument } from '@/app/tabs'

/** Runs a save only while a document is in front: Home and a New file tab have none. */
function onDocument(run: () => void): () => void {
  return () => {
    if (showsDocument()) run()
  }
}

export function createSaveMenuActions(store: EditorStore) {
  return {
    save: onDocument(() => void store.saveFigFile()),
    'save-as': onDocument(() => void store.saveFigFileAs()),
    'save-to': onDocument(() => void openSaveTo(store)),
    // A Cloud document's history is the server's; any other document keeps its own here.
    'save-version': onDocument(() => {
      if (isCloudBinding(store.getStorageBinding())) openVersionDialog(store)
      // The menu's store follows the active tab; history is kept per tab's own store.
      else openLocalVersionDialog(getActiveEditorStore())
    }),
    'version-history': onDocument(() => {
      if (isCloudBinding(store.getStorageBinding())) openVersionHistory(store)
      else void openLocalHistory(getActiveEditorStore())
    })
  }
}
