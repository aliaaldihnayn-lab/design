import type { Fill, SceneNode } from '@lawha/scene-graph'
import { LAWHA_PLUGIN_DATA, readPluginData } from '@lawha/scene-graph/plugin-data'
import { photoMessages } from '@lawha/vue/i18n'

import type { EditorStore } from '@/app/editor/active-store'
import { toast } from '@/app/shell/ui'

import { removeImageBackground } from './model'

const busyStores = new WeakSet<EditorStore>()

/**
 * The index of the layer's top visible image fill, or -1. The paint layer the pixel tools keep on
 * top is paint, not the photo, so it is passed over.
 */
function imageFillIndex(node: SceneNode): number {
  const paint = readPluginData(node.pluginData, LAWHA_PLUGIN_DATA.paintLayer)?.hash
  for (let i = node.fills.length - 1; i >= 0; i--) {
    const fill = node.fills[i]
    if (fill.type === 'IMAGE' && fill.imageHash && fill.visible && fill.imageHash !== paint) {
      return i
    }
  }
  return -1
}

function selectedImageNode(store: EditorStore): SceneNode | null {
  if (store.state.selectedIds.size !== 1) return null
  const id = store.state.selectedIds.values().next().value
  const node = id ? store.graph.getNode(id) : undefined
  return node && imageFillIndex(node) >= 0 ? node : null
}

export function canRemoveBackground(store: EditorStore): boolean {
  return !busyStores.has(store) && selectedImageNode(store) !== null
}

/**
 * Replaces the selected layer's image with a copy whose background is transparent. One undo
 * step brings the original back; the original stays in the file until it is saved without it.
 * `remove` makes the cut-out, the on-device model unless another is given.
 */
export async function removeBackgroundFromSelection(
  store: EditorStore,
  remove: (bytes: Uint8Array) => Promise<Uint8Array> = removeImageBackground
): Promise<void> {
  const node = selectedImageNode(store)
  if (!node || busyStores.has(store)) return
  const index = imageFillIndex(node)
  const fill = node.fills[index]
  const bytes = fill.imageHash ? store.graph.images.get(fill.imageHash) : undefined
  const messages = photoMessages.get()
  if (!bytes) return
  busyStores.add(store)
  toast.info(messages.removingBackground)
  try {
    const cutout = await remove(bytes)
    const current = store.graph.getNode(node.id)
    if (!current || current.fills[index]?.imageHash !== fill.imageHash) {
      throw new Error('The image changed while the background was being removed')
    }
    const hash = store.storeImage(cutout)
    const fills: Fill[] = current.fills.map((f, i) => (i === index ? { ...f, imageHash: hash } : f))
    store.updateNodeWithUndo(current.id, { fills }, messages.removeBackground)
    toast.info(messages.backgroundRemoved)
  } catch (error) {
    toast.error(
      messages.removeBackgroundFailed({
        error: error instanceof Error ? error.message : String(error)
      })
    )
  } finally {
    busyStores.delete(store)
  }
}
