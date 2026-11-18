import { watchDebounced } from '@vueuse/core'
import { encode } from 'js-base64'
import { ref, shallowRef, type Ref } from 'vue'

import { getActiveEditorStoreOrNull, type EditorStore } from '@/app/editor/active-store'

import { traceImageBytes, type LocalTraceOptions } from '../local'

/** How long the preview waits after a setting changes before it traces again. */
const PREVIEW_DEBOUNCE_MS = 200
/** The side of the sample the preview traces when no image layer is selected, in pixels. */
const SAMPLE_SIZE = 160

/** The image of the one selected image layer, which the preview traces when there is one. */
function selectedImage(store: EditorStore): Uint8Array | null {
  if (store.state.selectedIds.size !== 1) return null
  const [id] = store.state.selectedIds
  const node = store.graph.getNode(id)
  const fill = node?.fills.length === 1 ? node.fills[0] : undefined
  if (fill?.type !== 'IMAGE' || !fill.imageHash) return null
  return store.graph.images.get(fill.imageHash) ?? null
}

/**
 * A sample with what the presets tell apart: soft colour, a flat shape, and dark lines, drawn
 * with CanvasKit so it needs no image file.
 */
function sampleImage(store: EditorStore): Uint8Array | null {
  const ck = store.renderer?.ck
  const surface = ck?.MakeSurface(SAMPLE_SIZE, SAMPLE_SIZE)
  if (!ck || !surface) return null
  const canvas = surface.getCanvas()
  canvas.clear(ck.WHITE)
  const paint = new ck.Paint()
  paint.setAntiAlias(true)
  const shader = ck.Shader.MakeLinearGradient(
    [0, 0],
    [SAMPLE_SIZE, SAMPLE_SIZE],
    [ck.Color(255, 180, 60, 1), ck.Color(220, 40, 90, 1)],
    null,
    ck.TileMode.Clamp
  )
  paint.setShader(shader)
  canvas.drawCircle(SAMPLE_SIZE * 0.38, SAMPLE_SIZE * 0.4, SAMPLE_SIZE * 0.28, paint)
  paint.setShader(null)
  shader.delete()
  paint.setColor(ck.Color(30, 90, 200, 1))
  canvas.drawRect(ck.XYWHRect(SAMPLE_SIZE * 0.55, SAMPLE_SIZE * 0.5, 56, 48), paint)
  paint.setStyle(ck.PaintStyle.Stroke)
  paint.setStrokeWidth(4)
  paint.setColor(ck.Color(20, 20, 20, 1))
  canvas.drawLine(12, SAMPLE_SIZE - 20, SAMPLE_SIZE - 12, SAMPLE_SIZE - 36, paint)
  paint.delete()
  const image = surface.makeImageSnapshot()
  const bytes = image.encodeToBytes()
  image.delete()
  surface.delete()
  return bytes
}

/**
 * A live preview of Image Trace with the settings being edited: the selected image layer, or a
 * sample when none is selected, traced again shortly after each change. It reports the traced
 * SVG as a data URL, how many colours it drew, and why it could not trace.
 */
export function useTracePreview(options: Readonly<Ref<LocalTraceOptions>>) {
  const url = ref<string | null>(null)
  const colors = ref(0)
  const error = ref('')
  const fromSelection = ref(false)
  const source = shallowRef<Uint8Array | null>(null)

  function trace() {
    const store = getActiveEditorStoreOrNull()
    const ck = store?.renderer?.ck
    if (!store || !ck) {
      url.value = null
      return
    }
    const selected = selectedImage(store)
    fromSelection.value = selected !== null
    source.value = selected ?? source.value ?? sampleImage(store)
    if (!source.value) return
    try {
      const traced = traceImageBytes(source.value, ck, options.value)
      url.value = `data:image/svg+xml;base64,${encode(traced.svg)}`
      colors.value = traced.colors
      error.value = ''
    } catch (cause) {
      url.value = null
      error.value = cause instanceof Error ? cause.message : String(cause)
    }
  }

  watchDebounced(options, trace, { debounce: PREVIEW_DEBOUNCE_MS, deep: true, immediate: true })

  return { url, colors, error, fromSelection }
}
