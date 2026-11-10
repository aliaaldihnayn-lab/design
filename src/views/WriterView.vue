<script setup lang="ts">
import { useHead } from '@unhead/vue'
import { useEventListener } from '@vueuse/core'
import { computed, onBeforeUnmount, ref } from 'vue'
import { useRouter } from 'vue-router'

import { localeDirection, useI18n, useWriterMessages } from '@lawha/vue/i18n'

import {
  openWordDocument,
  saveWriterDocument,
  saveWriterDocumentAs,
  type WriterFileOutcome
} from '@/app/writer/document'
import { WRITER_FONTS_STYLESHEET } from '@/app/writer/fonts'
import {
  newWriterDocument,
  writerDirty,
  writerDocument,
  writerName,
  writerTitle
} from '@/app/writer/session'
import IconButton from '@/components/ui/button/IconButton.vue'
import AppAlert from '@/components/ui/feedback/AppAlert.vue'
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
const busy = ref(false)
const error = ref<string | null>(null)
const statusLabel = computed(() => {
  if (busy.value) return t.value.saving
  return writerDirty.value ? t.value.unsaved : t.value.saved
})

function report(outcome: WriterFileOutcome, failed: (detail: string) => string) {
  if (outcome.status !== 'failed') {
    error.value = null
    return
  }
  if (outcome.reason === 'not-docx') error.value = t.value.notDocx
  else if (outcome.reason === 'encrypted') error.value = t.value.encrypted
  else error.value = failed(outcome.detail)
}

async function run(action: () => Promise<WriterFileOutcome>, failed: (detail: string) => string) {
  if (busy.value) return
  busy.value = true
  try {
    report(await action(), failed)
  } finally {
    busy.value = false
  }
}

const openFailed = (detail: string) => t.value.openFailed({ error: detail })
const saveFailed = (detail: string) => t.value.saveFailed({ error: detail })

function createDocument() {
  newWriterDocument(localeDirection(locale.value))
}

useEventListener(window, 'keydown', (event: KeyboardEvent) => {
  if (!(event.ctrlKey || event.metaKey) || event.code !== 'KeyS') return
  event.preventDefault()
  void run(event.shiftKey ? saveWriterDocumentAs : saveWriterDocument, saveFailed)
})
useEventListener(window, 'beforeunload', (event: BeforeUnloadEvent) => {
  if (writerDirty.value) event.preventDefault()
})

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
      <span :class="ui.status()" role="status" data-test-id="writer-status">
        {{ statusLabel }}
      </span>
      <div :class="ui.group()">
        <IconButton :label="t.newDocument" data-test-id="writer-new" @click="createDocument">
          <icon-lucide-file-plus class="size-3.5" />
        </IconButton>
        <IconButton
          :label="t.openWord"
          data-test-id="writer-open"
          @click="run(openWordDocument, openFailed)"
        >
          <icon-lucide-folder-open class="size-3.5" />
        </IconButton>
        <IconButton
          :label="t.save"
          data-test-id="writer-save"
          @click="run(saveWriterDocument, saveFailed)"
        >
          <icon-lucide-save class="size-3.5" />
        </IconButton>
        <IconButton
          :label="t.downloadDocx"
          data-test-id="writer-save-as"
          @click="run(saveWriterDocumentAs, saveFailed)"
        >
          <icon-lucide-download class="size-3.5" />
        </IconButton>
      </div>
    </div>
    <WriterToolbar v-if="editor" :editor="editor" />
    <AppAlert v-if="error" tone="error" :heading="error" class="m-2" />
    <div :class="ui.workspace()">
      <div :class="ui.scroller()">
        <WriterPaper v-if="editor" :editor="editor" :page="page" />
      </div>
    </div>
  </div>
</template>
