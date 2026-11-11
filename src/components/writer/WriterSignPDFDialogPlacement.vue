<script setup lang="ts">
import { computed, ref } from 'vue'

import type { PDFPagePreview, SignatureField } from '@lawha/core/pdf-sign'
import type { Vector } from '@lawha/scene-graph/primitives'
import { useWriterMessages } from '@lawha/vue/i18n'

import { boxFromGesture, rectToBox, type PageBox } from '@/app/writer/placement'
import IconButton from '@/components/ui/button/IconButton.vue'

import { writer } from './ui'

/**
 * A page of the PDF to sign, where the person clicks or drags to place the visible signature,
 * on any page; the file's own empty signature fields show as boxes to sign into instead.
 */
export interface SignaturePlacement {
  page: number
  box: PageBox
  /** The empty field signed into, when the person picked one of the file's. */
  fieldName: string | null
}

const { previews, fields } = defineProps<{
  previews: readonly PDFPagePreview[]
  fields: readonly SignatureField[]
}>()
const placement = defineModel<SignaturePlacement>({ required: true })
const t = useWriterMessages()
const ui = writer()

const page = computed(() => previews.at(placement.value.page) ?? previews.at(0))
const imageURL = computed(() =>
  page.value ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(page.value.svg)}` : ''
)
const pageFields = computed(() =>
  fields.filter((field) => !field.signed && field.page === placement.value.page)
)

const surface = ref<HTMLElement | null>(null)
const start = ref<Vector | null>(null)
const dragging = ref<PageBox | null>(null)

function fraction(event: PointerEvent) {
  const rect = surface.value?.getBoundingClientRect()
  if (!rect || rect.width === 0 || rect.height === 0) return null
  return {
    x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
    y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height))
  }
}

function press(event: PointerEvent) {
  if (event.button !== 0) return
  start.value = fraction(event)
  surface.value?.setPointerCapture(event.pointerId)
}

function move(event: PointerEvent) {
  const from = start.value
  const to = fraction(event)
  if (!from || !to || !page.value) return
  dragging.value = boxFromGesture(from, to, page.value)
}

function release(event: PointerEvent) {
  const from = start.value
  const to = fraction(event)
  start.value = null
  dragging.value = null
  if (!from || !to || !page.value) return
  placement.value = {
    ...placement.value,
    box: boxFromGesture(from, to, page.value),
    fieldName: null
  }
}

function chooseField(field: SignatureField) {
  if (!page.value) return
  placement.value = {
    page: field.page,
    box: rectToBox(field.rect, page.value),
    fieldName: field.name
  }
}

function turn(step: number) {
  const next = Math.min(previews.length - 1, Math.max(0, placement.value.page + step))
  if (next !== placement.value.page)
    placement.value = { ...placement.value, page: next, fieldName: null }
}

const percent = (box: PageBox) => ({
  insetInlineStart: `${box.x * 100}%`,
  top: `${box.y * 100}%`,
  width: `${box.width * 100}%`,
  height: `${box.height * 100}%`
})
const shown = computed(() => dragging.value ?? placement.value.box)
</script>

<template>
  <div class="flex flex-col gap-1.5" data-test-id="writer-sign-placement">
    <div class="flex items-center justify-between gap-1">
      <span class="text-muted">{{ t.placeSignature }}</span>
      <div class="flex items-center gap-0.5">
        <IconButton :label="t.previousPage" :disabled="placement.page === 0" @click="turn(-1)">
          <icon-lucide-chevron-left class="size-3.5 rtl:-scale-x-100" />
        </IconButton>
        <span class="tabular-nums" data-test-id="writer-sign-page">{{
          t.pageOf({ page: placement.page + 1, count: previews.length })
        }}</span>
        <IconButton
          :label="t.nextPage"
          :disabled="placement.page >= previews.length - 1"
          @click="turn(1)"
        >
          <icon-lucide-chevron-right class="size-3.5 rtl:-scale-x-100" />
        </IconButton>
      </div>
    </div>
    <div
      v-if="page"
      ref="surface"
      dir="ltr"
      :class="ui.signPage()"
      :style="{ aspectRatio: `${page.width} / ${page.height}` }"
      data-test-id="writer-sign-surface"
      @pointerdown="press"
      @pointermove="move"
      @pointerup="release"
    >
      <img
        :src="imageURL"
        alt=""
        class="pointer-events-none size-full select-none"
        draggable="false"
      />
      <button
        v-for="field in pageFields"
        :key="field.name"
        type="button"
        :class="ui.signField()"
        :style="percent(rectToBox(field.rect, page))"
        :aria-label="t.signatureField({ name: field.name })"
        :data-selected="placement.fieldName === field.name ? '' : undefined"
        @pointerdown.stop
        @click="chooseField(field)"
      />
      <div
        v-if="!placement.fieldName"
        :class="ui.signBox()"
        :style="percent(shown)"
        data-test-id="writer-sign-box"
      />
    </div>
  </div>
</template>
