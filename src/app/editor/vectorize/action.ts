import { traceableImageFill } from '@lawha/core/tools'
import { preprocessForVectorize, svgToVectorPaths } from '@lawha/core/vector'
import { pathMessages } from '@lawha/vue/i18n'

import type { EditorStore } from '@/app/editor/active-store'
import { notificationMessages } from '@/app/i18n/notifications'
import { openSettingsDialog } from '@/app/settings/dialog'
import { toast } from '@/app/shell/ui'

import { resolveVectorizeCredential } from './credentials'
import { LOCAL_TRACE_PROVIDER, type LocalTraceOptions } from './local'
import { vectorizeProviderID } from './preferences'
import { getVectorizeProvider } from './providers'
import { VectorizeAuthError } from './types'

const activeStores = new WeakSet<EditorStore>()
const ERROR_MAX_LENGTH = 240

/** The layer and its image, when the layer is only an image and no conversion runs for `store`. */
function traceableImage(store: EditorStore, nodeId: string) {
  if (activeStores.has(store)) return null
  const node = store.graph.getNode(nodeId)
  const fill = node ? traceableImageFill(node) : null
  if (!node || fill?.type !== 'IMAGE' || !fill.imageHash) return null
  return { node, imageHash: fill.imageHash }
}

export function canVectorizeImageNode(store: EditorStore): boolean {
  if (store.state.selectedIds.size !== 1 || activeStores.has(store)) return false
  const nodeId = store.state.selectedIds.values().next().value
  if (!nodeId) return false
  const node = store.graph.getNode(nodeId)
  return Boolean(node && traceableImageFill(node))
}

function vectorizeErrorMessage(error: unknown): string {
  let message = 'Vectorization failed'
  if (error instanceof TypeError) message = error.message || 'Network request failed'
  else if (error instanceof Error) message = error.message
  return message.length <= ERROR_MAX_LENGTH ? message : `${message.slice(0, ERROR_MAX_LENGTH)}…`
}

export async function vectorizeImageNode(store: EditorStore, nodeId: string): Promise<void> {
  const image = traceableImage(store, nodeId)
  if (!image) return
  const { node, imageHash } = image

  const provider = getVectorizeProvider(vectorizeProviderID.value)
  activeStores.add(store)
  try {
    const apiKey = await resolveVectorizeCredential(provider.id)
    if (!apiKey) {
      toast.error(
        notificationMessages.get().vectorizeCredentialRequired({ provider: provider.name })
      )
      openSettingsDialog('services')
      return
    }

    const imageBytes = store.graph.images.get(imageHash)
    if (!imageBytes) {
      toast.error(notificationMessages.get().vectorizeImageMissing)
      return
    }

    toast.info(notificationMessages.get().vectorizingImage)
    const preprocessed = preprocessForVectorize(imageBytes, () => store.renderer?.ck ?? null)
    if (!preprocessed) throw new Error('Could not prepare this image for vectorization')

    const svg = await provider.vectorize(preprocessed.pngBytes, apiKey)
    const currentNode = store.graph.getNode(node.id)
    const currentFill = currentNode ? traceableImageFill(currentNode) : null
    if (!currentNode || currentFill?.type !== 'IMAGE' || currentFill.imageHash !== imageHash) {
      throw new Error('The image changed before vectorization finished')
    }
    const vectorized = svgToVectorPaths(svg, {
      width: currentNode.width,
      height: currentNode.height
    })
    if (!vectorized?.paths.length) throw new Error('The vectorizer returned no editable paths')

    const frameId = store.replaceNodeWithVectorFrame(currentNode.id, vectorized)
    if (!frameId) throw new Error('Could not replace this image with vector layers')
    toast.info(notificationMessages.get().imageConvertedToVectors)
  } catch (error) {
    if (error instanceof VectorizeAuthError) {
      toast.error(notificationMessages.get().vectorizeCredentialFailed({ error: error.message }))
      openSettingsDialog('services')
    } else {
      toast.error(
        notificationMessages
          .get()
          .vectorizeFailed({ provider: provider.name, error: vectorizeErrorMessage(error) })
      )
    }
  } finally {
    activeStores.delete(store)
  }
}

/**
 * Traces an image layer into vector layers on this device with the offline provider, in one
 * undo step, as Convert to vector does with a cloud service.
 */
export async function traceImageNodeOnDevice(
  store: EditorStore,
  nodeId: string,
  options?: LocalTraceOptions
): Promise<void> {
  const image = traceableImage(store, nodeId)
  if (!image) return
  const { node, imageHash } = image
  const messages = pathMessages.get()
  activeStores.add(store)
  try {
    const imageBytes = store.graph.images.get(imageHash)
    if (!imageBytes) {
      toast.error(notificationMessages.get().vectorizeImageMissing)
      return
    }
    const ck = store.renderer?.ck
    if (!ck) throw new Error('The canvas is not ready yet')
    toast.info(messages.tracingImage)
    // Let the toast paint before the trace takes the main thread.
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0)
    })
    const svg = LOCAL_TRACE_PROVIDER.vectorize(imageBytes, ck, options)
    const vectorized = svgToVectorPaths(svg, { width: node.width, height: node.height })
    if (!vectorized?.paths.length) throw new Error('The trace found no shapes')
    const frameId = store.replaceNodeWithVectorFrame(node.id, vectorized)
    if (!frameId) throw new Error('Could not replace this image with vector layers')
    toast.info(messages.imageTraced)
  } catch (error) {
    toast.error(messages.traceFailed({ error: vectorizeErrorMessage(error) }))
  } finally {
    activeStores.delete(store)
  }
}
