<script setup lang="ts">
import { EditorContent, type Editor } from '@tiptap/vue-3'
import { computed } from 'vue'

import type { PageSetup } from '@lawha/core/writer'

import { paperWidth, type PaginationSection } from '@/app/writer/editor/pagination'
import { PAGE_GAP, paginationSection } from '@/app/writer/editor/pagination/regions'

import { writer } from './ui'

/**
 * The pages as they print: a sheet for each page at its section's size, the first page's header
 * and the last page's footer editable in the margins, and the pages between drawn by the body's
 * pagination. The paper is as wide as the widest sheet, and sheets are centred on it.
 */
const {
  editor,
  page,
  firstPage = page,
  sheets = [],
  pages = 1,
  watermark = null
} = defineProps<{
  editor: Editor
  /** The document's own page setup, which its last section and the paper's column use. */
  page: PageSetup
  /** The first section's page setup, where the first page's header sits. */
  firstPage?: PageSetup
  /** Each page's sheet, as the pagination laid them out. */
  sheets?: ReadonlyArray<PaginationSection | null>
  /** How many pages the body fills. */
  pages?: number
  watermark?: string | null
}>()
const ui = writer()

const base = computed(() => paginationSection(page))
const first = computed(() => paginationSection(firstPage))
const drawn = computed(() => {
  const known = sheets.filter((sheet): sheet is PaginationSection => sheet !== null)
  const list = known.length ? known : [base.value]
  return Array.from({ length: Math.max(pages, list.length) }, (_, index) => {
    return list[index] ?? list.at(-1) ?? base.value
  })
})
const width = computed(() => paperWidth([base.value, first.value, ...drawn.value]))
const textLeft = (sheet: PaginationSection) => (width.value - sheet.width) / 2 + sheet.left
const textWidth = (sheet: PaginationSection) => sheet.width - sheet.left - sheet.right

const sheetBoxes = computed(() => {
  let top = 0
  return drawn.value.map((sheet) => {
    const box = {
      top: `${top}px`,
      left: `${(width.value - sheet.width) / 2}px`,
      width: `${sheet.width}px`,
      height: `${sheet.height}px`
    }
    top += sheet.height + PAGE_GAP
    return box
  })
})

const paperStyle = computed(() => {
  const left = textLeft(base.value)
  return {
    width: `${width.value}px`,
    minHeight: `${drawn.value.reduce((sum, sheet) => sum + sheet.height, 0) + (drawn.value.length - 1) * PAGE_GAP}px`,
    paddingLeft: `${left}px`,
    paddingRight: `${width.value - left - textWidth(base.value)}px`
  }
})
const topStyle = computed(() => ({
  minHeight: `${first.value.top}px`,
  paddingTop: `${first.value.headerDistance}px`,
  width: `${textWidth(first.value)}px`,
  translate: `${textLeft(first.value) - textLeft(base.value)}px 0`
}))
const bottomStyle = computed(() => ({
  minHeight: `${base.value.bottom}px`,
  paddingBottom: `${base.value.footerDistance}px`
}))
</script>

<template>
  <div :class="ui.paper()" :style="paperStyle" dir="ltr" data-test-id="writer-paper">
    <div
      v-for="(sheet, index) in sheetBoxes"
      :key="index"
      :class="ui.sheet()"
      :style="sheet"
      aria-hidden="true"
      data-test-id="writer-sheet"
    />
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
