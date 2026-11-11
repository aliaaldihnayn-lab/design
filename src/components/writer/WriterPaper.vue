<script setup lang="ts">
import { EditorContent, type Editor } from '@tiptap/vue-3'
import { computed } from 'vue'

import { twipsToPx, type PageSetup } from '@lawha/core/writer'

import { PAGE_GAP } from '@/app/writer/editor/pagination/regions'

import { writer } from './ui'

/**
 * The pages as they print: their size and margins, the first page's header and the last page's
 * footer editable in the margins, and the pages between drawn by the body's pagination.
 */
const {
  editor,
  page,
  pages = 1,
  watermark = null
} = defineProps<{
  editor: Editor
  page: PageSetup
  /** How many pages the body fills; the paper is that many sheets tall. */
  pages?: number
  watermark?: string | null
}>()
const ui = writer()

const paperStyle = computed(() => ({
  width: `${twipsToPx(page.width)}px`,
  minHeight: `${pages * twipsToPx(page.height) + (pages - 1) * PAGE_GAP}px`,
  paddingInline: `${twipsToPx(page.margins.left)}px ${twipsToPx(page.margins.right)}px`
}))
const topStyle = computed(() => ({
  minHeight: `${twipsToPx(page.margins.top)}px`,
  paddingTop: `${twipsToPx(page.margins.header)}px`
}))
const bottomStyle = computed(() => ({
  minHeight: `${twipsToPx(page.margins.bottom)}px`,
  paddingBottom: `${twipsToPx(page.margins.footer)}px`
}))
</script>

<template>
  <div :class="ui.paper()" :style="paperStyle" dir="ltr" data-test-id="writer-paper">
    <div v-if="watermark" :class="ui.watermark()" aria-hidden="true">
      <span :class="ui.watermarkText()">{{ watermark }}</span>
    </div>
    <div :style="topStyle"><slot name="header" /></div>
    <div :class="ui.body()">
      <EditorContent :editor="editor" :class="ui.content()" />
      <slot name="footnotes" />
    </div>
    <div :style="bottomStyle" class="flex flex-col justify-end"><slot name="footer" /></div>
  </div>
</template>
