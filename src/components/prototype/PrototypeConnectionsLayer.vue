<script setup lang="ts">
import { useElementSize } from '@vueuse/core'
import { computed, ref, useTemplateRef, watchEffect } from 'vue'

import type { ViewportTransform } from '@lawha/core/geometry'
import {
  canvasRect,
  noodle,
  type Noodle,
  prototypeConnections,
  screenAt,
  screenOf
} from '@lawha/core/prototype'
import type { Rect, Vector } from '@lawha/scene-graph/primitives'
import { usePrototypeMessages } from '@lawha/vue/i18n'

import { useEditorStore } from '@/app/editor/active-store'
import { linkToScreen, showPrototypeConnections } from '@/app/prototype/connections'
import { toast } from '@/app/shell/ui'

const { canvasEl, drawn = null } = defineProps<{
  canvasEl: HTMLCanvasElement | null
  /** The pan and zoom of the canvas's last drawn frame, which the noodles follow. */
  drawn?: ViewportTransform | null
}>()

/** The handle's radius and the arrowhead's length, in screen pixels. */
const HANDLE_RADIUS = 6
const ARROW = 9

const store = useEditorStore()
const t = usePrototypeMessages()
const root = useTemplateRef<HTMLElement>('root')

const view = computed<ViewportTransform>(() => drawn ?? store.state)
const toScreen = (rect: Rect): Rect => ({
  x: rect.x * view.value.zoom + view.value.panX,
  y: rect.y * view.value.zoom + view.value.panY,
  width: rect.width * view.value.zoom,
  height: rect.height * view.value.zoom
})

const pageId = computed(() => store.state.currentPageId)

const noodles = computed(() => {
  void store.state.sceneVersion
  if (!showPrototypeConnections.value) return []
  const selected = store.state.selectedIds
  return prototypeConnections(store.graph, pageId.value).flatMap((link, index) => {
    const from = canvasRect(store.graph, link.source)
    const to = canvasRect(store.graph, link.target)
    if (!from || !to) return []
    const line = noodle(toScreen(from), toScreen(to), ARROW)
    return [{ key: `${link.source}-${index}`, line, active: selected.has(link.source), link }]
  })
})

/** The single selected layer inside a screen, which a new connection starts from. */
const source = computed(() => {
  void store.state.sceneVersion
  if (!showPrototypeConnections.value || store.state.selectedIds.size !== 1) return null
  const [id] = store.state.selectedIds
  if (!screenOf(store.graph, id, pageId.value)) return null
  const rect = canvasRect(store.graph, id)
  return rect ? { id, rect: toScreen(rect) } : null
})

const handle = computed<Vector | null>(() => {
  const s = source.value
  return s ? { x: s.rect.x + s.rect.width, y: s.rect.y + s.rect.height / 2 } : null
})

const drag = ref<{ pointer: Vector; target: string | null } | null>(null)

function localPoint(event: PointerEvent): Vector {
  const box = root.value?.getBoundingClientRect()
  return { x: event.clientX - (box?.left ?? 0), y: event.clientY - (box?.top ?? 0) }
}

function canvasPoint(point: Vector): Vector {
  return {
    x: (point.x - view.value.panX) / view.value.zoom,
    y: (point.y - view.value.panY) / view.value.zoom
  }
}

/** The screen under the pointer that a connection can go to: not the one it starts on. */
function dropTarget(point: Vector): string | null {
  const s = source.value
  if (!s) return null
  const target = screenAt(store.graph, pageId.value, canvasPoint(point))
  return target && target !== screenOf(store.graph, s.id, pageId.value)?.id ? target : null
}

function onPointerDown(event: PointerEvent) {
  if (event.button !== 0) return
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  const pointer = localPoint(event)
  drag.value = { pointer, target: dropTarget(pointer) }
}

function onPointerMove(event: PointerEvent) {
  if (!drag.value) return
  const pointer = localPoint(event)
  drag.value = { pointer, target: dropTarget(pointer) }
}

async function onPointerUp() {
  const current = drag.value
  const s = source.value
  drag.value = null
  if (!current?.target || !s) return
  const error = await linkToScreen(store, s.id, current.target, t.value.section)
  if (error) toast.error(t.value.failed({ error }))
}

const dragLine = computed(() => {
  const d = drag.value
  const s = source.value
  if (!d || !s) return null
  const targetRect = d.target ? canvasRect(store.graph, d.target) : null
  return noodle(s.rect, targetRect ? toScreen(targetRect) : d.pointer, ARROW)
})

const targetBox = computed(() => {
  const id = drag.value?.target
  const rect = id ? canvasRect(store.graph, id) : null
  return rect ? toScreen(rect) : null
})

function forwardWheel(event: WheelEvent) {
  if (!canvasEl) return
  event.preventDefault()
  canvasEl.dispatchEvent(new WheelEvent('wheel', event))
}

const LINK_COLOR = '#38bdf8'
const board = useTemplateRef<HTMLCanvasElement>('board')
const { width, height } = useElementSize(root)

function strokeNoodle(ctx: CanvasRenderingContext2D, line: Noodle, emphasis: boolean) {
  ctx.globalAlpha = emphasis ? 1 : 0.7
  ctx.lineWidth = emphasis ? 2 : 1.5
  ctx.beginPath()
  ctx.moveTo(line.start.x, line.start.y)
  ctx.bezierCurveTo(line.c1.x, line.c1.y, line.c2.x, line.c2.y, line.end.x, line.end.y)
  ctx.stroke()
  ctx.globalAlpha = 1
  const [a, b, tip] = line.arrow
  ctx.beginPath()
  ctx.moveTo(a.x, a.y)
  ctx.lineTo(b.x, b.y)
  ctx.lineTo(tip.x, tip.y)
  ctx.closePath()
  ctx.fill()
}

// Noodles draw on a 2D canvas over the design, in screen pixels, as Figma draws them.
watchEffect(() => {
  const el = board.value
  if (!el) return
  const dpr = window.devicePixelRatio || 1
  el.width = Math.round(width.value * dpr)
  el.height = Math.round(height.value * dpr)
  const ctx = el.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, width.value, height.value)
  ctx.strokeStyle = LINK_COLOR
  ctx.fillStyle = LINK_COLOR
  for (const item of noodles.value) {
    strokeNoodle(ctx, item.line, item.active)
    ctx.beginPath()
    ctx.arc(item.line.start.x, item.line.start.y, 3, 0, Math.PI * 2)
    ctx.fill()
  }
  const box = targetBox.value
  if (box) {
    ctx.lineWidth = 2
    ctx.strokeRect(box.x, box.y, box.width, box.height)
  }
  if (dragLine.value) strokeNoodle(ctx, dragLine.value, true)
})
</script>

<template>
  <div
    v-if="showPrototypeConnections"
    ref="root"
    class="pointer-events-none absolute inset-0 z-0 overflow-hidden"
    data-canvas-overlay="prototype-connections"
    data-test-id="prototype-connections"
    :data-connections="noodles.length"
    :data-drop-target="drag ? (drag.target ?? '') : undefined"
    @wheel="forwardWheel"
  >
    <canvas ref="board" class="absolute inset-0 size-full" aria-hidden="true" />
    <button
      v-if="handle"
      type="button"
      class="pointer-events-auto absolute cursor-crosshair rounded-full border-2 border-white bg-[#38bdf8] shadow"
      :style="{
        left: `${handle.x - HANDLE_RADIUS}px`,
        top: `${handle.y - HANDLE_RADIUS}px`,
        width: `${HANDLE_RADIUS * 2}px`,
        height: `${HANDLE_RADIUS * 2}px`
      }"
      :aria-label="t.connectHandle"
      data-test-id="prototype-connection-handle"
      @pointerdown.stop.prevent="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="drag = null"
    />
  </div>
</template>
