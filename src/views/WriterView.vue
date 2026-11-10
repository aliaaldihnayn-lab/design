<script setup lang="ts">
import { useHead } from '@unhead/vue'
import { computed, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'

import { localeDirection, useI18n, useWriterMessages } from '@lawha/vue/i18n'

import { WRITER_FONTS_STYLESHEET } from '@/app/writer/fonts'
import {
  newWriterDocument,
  writerDirty,
  writerDocument,
  writerName,
  writerTitle
} from '@/app/writer/session'
import AppButton from '@/components/ui/button/AppButton.vue'
import IconButton from '@/components/ui/button/IconButton.vue'
import { writer } from '@/components/writer/ui'
import { useWriterEditor } from '@/components/writer/useWriterEditor'
import WriterPaper from '@/components/writer/WriterPaper.vue'
import WriterToolbar from '@/components/writer/WriterToolbar.vue'

const t = useWriterMessages()
const { locale } = useI18n()
const router = useRouter()
const ui = writer()

useHead({
  title: computed(() => writerTitle.value || t.value.untitled),
  link: [{ rel: 'stylesheet', href: WRITER_FONTS_STYLESHEET }]
})

const editor = useWriterEditor(() => t.value.untitled)
const page = computed(() => writerDocument.value.page)

function createDocument() {
  newWriterDocument(localeDirection(locale.value))
}

onBeforeUnmount(() => editor.value?.destroy())
</script>

<template>
  <div :class="ui.root()" data-test-id="writer-view">
    <div :class="ui.titleRow()">
      <IconButton :label="t.backHome" @click="router.push('/')">
        <icon-lucide-arrow-left class="size-3.5 rtl:-scale-x-100" />
      </IconButton>
      <icon-lucide-file-text class="size-4 shrink-0 text-muted" />
      <input
        v-model="writerName"
        :class="ui.title()"
        :placeholder="writerDocument.title || t.untitled"
        :aria-label="t.documentName"
      />
      <span :class="ui.status()" role="status">{{ writerDirty ? t.unsaved : t.saved }}</span>
      <AppButton size="sm" variant="outline" data-test-id="writer-new" @click="createDocument">
        <template #leading><icon-lucide-file-plus class="size-3.5" /></template>
        {{ t.newDocument }}
      </AppButton>
    </div>
    <WriterToolbar v-if="editor" :editor="editor" />
    <div :class="ui.workspace()">
      <div :class="ui.scroller()">
        <WriterPaper v-if="editor" :editor="editor" :page="page" />
      </div>
    </div>
  </div>
</template>
