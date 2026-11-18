<script setup lang="ts">
import { onKeyStroke, useElementSize, useEventListener } from '@vueuse/core'
import { computed, ref, useTemplateRef, watchEffect } from 'vue'

import type { ViewportTransform } from '@lawha/core/geometry'
import {
  canvasRect,
  noodle,
  noodleAt,
  type Noodle,
  prototypeConnections,
  screenAt,
  screenOf
} from '@lawha/core/prototype'
import type { Rect, Vector } from '@lawha/scene-graph/primitives'
import { usePrototypeMessages } from '@lawha/vue/i18n'

import { useEditorStore } from '@/app/editor/active-store'
import {
  linkToScreen,
  removeConnection,
  retargetConnection,
  showPrototypeConnections,
  type ConnectionRef
} from '@/app/prototype/connections'
import { toast } from '@/app/shell/ui'

const { canvasEl, drawn = null } = defineProps<{
  canvasEl: HTMLCanvasElement | null
  /** The pan and zoom of the canvas's last drawn frame, which the noodles follow. */
  drawn?: ViewportTransform | null
}>()

/** The handle's radius, the arrowhead's length, and how near a click selects a noodle, in px. */
const HANDLE_RADIUS = 6
const ARROW = 9
const HIT_TOLERANCE = 6

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
    const picked =
      chosen.value?.source === link.source && chosen.value.interaction === link.interaction
    return [
      {
        key: `${link.source}-${index}`,
        line,
        active: picked || selected.has(link.source),
        picked,
        link
      }
    ]
  })
})

/** The noodle selected on the canvas, which Delete removes and whose end drags to retarget. */
const chosen = ref<ConnectionRef | null>(null)
const chosenNoodle = computed(() => noodles.value.find((item) => item.picked) ?? null)

// A click on a noodle selects it instead of the layer under it, as in Figma.
useEventListener(
  () => canvasEl,
  'pointerdown',
  (event: PointerEvent) => {
    if (event.button !== 0 || !root.value) return
    const index = noodleAt(
      noodles.value.map((item) => item.line),
      localPoint(event),
      HIT_TOLERANCE
    )
    if (index === null) {
      chosen.value = null
      return
    }
    event.preventDefault()
    event.stopImmediatePropagation()
    const { link } = noodles.value[index]
    chosen.value = { source: link.source, interaction: link.interaction }
  },
  { capture: true }
)

async function report(work: Promise<string | null>) {
  const error = await work
  if (error) toast.error(t.value.failed({ error }))
}

onKeyStroke(
  ['Delete', 'Backspace', 'Escape'],
  (event) => {
    const link = chosen.value
    if (!link) return
    event.preventDefault()
    event.stopImmediatePropagation()
    chosen.value = null
    if (event.key !== 'Escape') void report(removeConnection(store, link, t.value.section))
  },
  { target: () => globalThis, eventName: 'keydown', dedupe: true }
)

/** Dragging a selected noodle's end: onto a screen retargets it, off every screen removes it. */
const retarget = ref<{ pointer: Vector; target: string | null } | null>(null)

function retargetTarget(point: Vector): string | null {
  const link = chosen.value
  if (!link) return null
  const target = screenAt(store.graph, pageId.value, canvasPoint(point))
  return target && target !== screenOf(store.graph, link.source, pageId.value)?.id ? target : null
}

function onEndDown(event: PointerEvent) {
  if (event.button !== 0) return
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  const pointer = localPoint(event)
  retarget.value = { pointer, target: retargetTarget(pointer) }
}

function onEndMove(event: PointerEvent) {
  if (!retarget.value) return
  const pointer = localPoint(event)
  retarget.value = { pointer, target: retargetTarget(pointer) }
}

function onEndUp() {
  const current = retarget.value
  const link = chosen.value
  retarget.value = null
  if (!current || !link) return
  chosen.value = null
  void report(
    current.target
      ? retargetConnection(store, link, current.target, t.value.section)
      : removeConnection(store, link, t.value.section)
  )
}

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
  const r = retarget.value
  const picked = chosenNoodle.value
  if (r && picked) {
    const from = canvasRect(store.graph, picked.link.source)
    const to = r.target ? canvasRect(store.graph, r.target) : null
    if (from) return noodle(toScreen(from), to ? toScreen(to) : r.pointer, ARROW)
  }
  const d = drag.value
  const s = source.value
  if (!d || !s) return null
  const targetRect = d.target ? canvasRect(store.graph, d.target) : null
  return noodle(s.rect, targetRect ? toScreen(targetRect) : d.pointer, ARROW)
})

const targetBox = computed(() => {
  const id = drag.value?.target ?? retarget.value?.target
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

function strokeNoodle(
  ctx: CanvasRenderingContext2D,
  line: Noodle,
  emphasis: boolean,
  picked = false
) {
  ctx.globalAlpha = emphasis ? 1 : 0.7
  ctx.lineWidth = 1.5
  if (emphasis) ctx.lineWidth = 2
  if (picked) ctx.lineWidth = 3
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
    if (item.picked && retarget.value) continue
    strokeNoodle(ctx, item.line, item.active, item.picked)
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
    :data-selected-connection="chosen ? `${chosen.source}:${chosen.interaction}` : undefined"
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
    <button
      v-if="chosenNoodle"
      type="button"
      class="pointer-events-auto absolute cursor-grab rounded-full border-2 border-[#38bdf8] bg-white shadow"
      :style="{
        left: `${chosenNoodle.line.end.x - HANDLE_RADIUS}px`,
        top: `${chosenNoodle.line.end.y - HANDLE_RADIUS}px`,
        width: `${HANDLE_RADIUS * 2}px`,
        height: `${HANDLE_RADIUS * 2}px`
      }"
      :aria-label="t.retargetHandle"
      data-test-id="prototype-connection-end"
      @pointerdown.stop.prevent="onEndDown"
      @pointermove="onEndMove"
      @pointerup="onEndUp"
      @pointercancel="retarget = null"
    />
  </div>
</template>
