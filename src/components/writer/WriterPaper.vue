<script setup lang="ts">
import { EditorContent, type Editor } from '@tiptap/vue-3'
import { computed } from 'vue'

import { twipsToPx, type PageSetup } from '@lawha/core/writer'

import { writer } from './ui'

/** The page as it prints: its size and margins, with the header and footer in the margins. */
const { editor, page } = defineProps<{ editor: Editor; page: PageSetup }>()
const ui = writer()

const paperStyle = computed(() => ({
  width: `${twipsToPx(page.width)}px`,
  minHeight: `${twipsToPx(page.height)}px`,
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
    <div :style="topStyle"><slot name="header" /></div>
    <EditorContent :editor="editor" :class="[ui.body(), ui.content()]" />
    <div :style="bottomStyle" class="flex flex-col justify-end"><slot name="footer" /></div>
  </div>
</template>
