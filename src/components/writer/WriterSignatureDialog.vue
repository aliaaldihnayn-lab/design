<script setup lang="ts">
import { fromUint8Array } from 'js-base64'
import { computed, nextTick, ref, watch } from 'vue'

import type { Vector } from '@lawha/scene-graph/primitives'
import { useWriterMessages } from '@lawha/vue/i18n'

import { placedSize, SIGNATURE_FONTS, trimmedPNG, typedSignature } from '@/app/writer/signature'
import AppButton from '@/components/ui/button/AppButton.vue'
import { AppDialog } from '@/components/ui/dialog'
import AppInput from '@/components/ui/input/AppInput.vue'
import AppSelect from '@/components/ui/select/AppSelect.vue'

/** Draw, type, or upload a signature; it is inserted as a transparent image to place and resize. */
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ insert: [image: { src: string; width: number; height: number }] }>()
const t = useWriterMessages()

type Mode = 'draw' | 'type' | 'upload'
const mode = ref<Mode>('draw')
const MODES: Array<{ value: Mode; label: 'draw' | 'type' | 'upload' }> = [
  { value: 'draw', label: 'draw' },
  { value: 'type', label: 'type' },
  { value: 'upload', label: 'upload' }
]
const INK = '#1a237e'

const canvas = ref<HTMLCanvasElement | null>(null)
const drawn = ref(false)
const typed = ref('')
const font = ref<string>(SIGNATURE_FONTS[0])
const uploaded = ref<{ src: string; width: number; height: number } | null>(null)
const fontOptions = SIGNATURE_FONTS.map((value) => ({ value, label: value }))

let last: Vector | null = null

function point(event: PointerEvent): Vector | null {
  const target = canvas.value
  if (!target) return null
  const rect = target.getBoundingClientRect()
  return {
    x: ((event.clientX - rect.left) / rect.width) * target.width,
    y: ((event.clientY - rect.top) / rect.height) * target.height
  }
}

function start(event: PointerEvent) {
  canvas.value?.setPointerCapture(event.pointerId)
  last = point(event)
}

function move(event: PointerEvent) {
  if (!last) return
  const next = point(event)
  const context = canvas.value?.getContext('2d')
  if (!next || !context) return
  // A pen's pressure thickens the stroke; mice and fingers report 0.5.
  context.lineWidth = 2 + (event.pressure || 0.5) * 4
  context.lineCap = 'round'
  context.lineJoin = 'round'
  context.strokeStyle = INK
  context.beginPath()
  context.moveTo(last.x, last.y)
  context.lineTo(next.x, next.y)
  context.stroke()
  last = next
  drawn.value = true
}

function end() {
  last = null
}

function clear() {
  const target = canvas.value
  target?.getContext('2d')?.clearRect(0, 0, target.width, target.height)
  drawn.value = false
}

async function upload(event: Event) {
  const file = event.target instanceof HTMLInputElement ? event.target.files?.[0] : undefined
  if (!file) return
  const bytes = new Uint8Array(await file.arrayBuffer())
  const src = `data:${file.type || 'image/png'};base64,${fromUint8Array(bytes)}`
  const image = new Image()
  image.src = src
  await image.decode().catch(() => undefined)
  uploaded.value = { src, width: image.naturalWidth || 300, height: image.naturalHeight || 100 }
}

const ready = computed(() => {
  if (mode.value === 'draw') return drawn.value
  if (mode.value === 'type') return typed.value.trim().length > 0
  return uploaded.value !== null
})

async function signatureImage() {
  if (mode.value === 'draw') return canvas.value ? trimmedPNG(canvas.value) : null
  if (mode.value === 'type') return typedSignature(typed.value.trim(), font.value, INK)
  return uploaded.value
}

async function insert() {
  const image = await signatureImage()
  if (!image) return
  // Drawn pixels are twice the canvas's CSS size, so the signature keeps its drawn size.
  const scale = mode.value === 'upload' ? 1 : 0.5
  emit('insert', { src: image.src, ...placedSize(image.width * scale, image.height * scale) })
  open.value = false
}

watch(open, async (isOpen) => {
  if (!isOpen) return
  typed.value = ''
  uploaded.value = null
  await nextTick()
  clear()
})
</script>

<template>
  <AppDialog
    v-model:open="open"
    size="md"
    :heading="t.addSignature"
    :close-label="t.cancel"
    data-test-id="writer-signature-dialog"
  >
    <div class="flex flex-col gap-3 text-xs">
      <div class="flex gap-1" role="radiogroup" :aria-label="t.signature">
        <AppButton
          v-for="item in MODES"
          :key="item.value"
          size="sm"
          role="radio"
          :aria-checked="mode === item.value"
          :variant="mode === item.value ? 'solid' : 'outline'"
          :data-test-id="`writer-signature-${item.value}`"
          @click="mode = item.value"
        >
          {{ t[item.label] }}
        </AppButton>
      </div>
      <div v-show="mode === 'draw'" class="flex flex-col gap-2">
        <canvas
          ref="canvas"
          width="960"
          height="320"
          class="h-40 w-full touch-none rounded-md border border-dashed border-border bg-white"
          :aria-label="t.draw"
          data-test-id="writer-signature-canvas"
          @pointerdown="start"
          @pointermove="move"
          @pointerup="end"
          @pointercancel="end"
        />
        <AppButton size="xs" variant="ghost" class="self-end" @click="clear">{{
          t.clear
        }}</AppButton>
      </div>
      <div v-if="mode === 'type'" class="flex flex-col gap-2">
        <AppInput
          v-model="typed"
          :aria-label="t.typeYourName"
          :placeholder="t.typeYourName"
          data-test-id="writer-signature-text"
        />
        <AppSelect v-model="font" :options="fontOptions" :label="t.signatureStyle" />
        <p
          class="min-h-16 rounded-md border border-border bg-white px-3 py-2 text-center text-4xl text-chart-1"
          :style="{ fontFamily: `'${font}', cursive` }"
        >
          {{ typed }}
        </p>
      </div>
      <div v-if="mode === 'upload'" class="flex flex-col gap-2">
        <input
          type="file"
          accept="image/png,image/jpeg"
          :aria-label="t.chooseImage"
          @change="upload"
        />
        <img
          v-if="uploaded"
          :src="uploaded.src"
          :alt="t.signature"
          class="max-h-32 self-start rounded-md bg-white p-2"
        />
      </div>
    </div>
    <template #footer>
      <AppButton
        size="sm"
        :disabled="!ready"
        data-test-id="writer-signature-insert"
        @click="insert"
      >
        {{ t.insertSignature }}
      </AppButton>
    </template>
  </AppDialog>
</template>
