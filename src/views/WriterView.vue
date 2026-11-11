<script setup lang="ts">
import { useHead } from '@unhead/vue'
import { useEventListener } from '@vueuse/core'
import { computed, onBeforeUnmount, ref } from 'vue'
import { useRouter } from 'vue-router'

import {
  documentStatistics,
  nodeText,
  writerTemplate,
  type WriterTemplateId
} from '@lawha/core/writer'
import { localeDirection, useHistoryMessages, useI18n, useWriterMessages } from '@lawha/vue/i18n'

import { useWriterHistory } from '@/app/history/writer'
import {
  openGoogleDocument,
  openWordDocument,
  saveWriterDocument,
  saveWriterDocumentAs,
  unlockWordDocument,
  type WriterFileOutcome
} from '@/app/writer/document'
import { WRITER_FONTS_STYLESHEET } from '@/app/writer/fonts'
import { printableHTML, printHTML } from '@/app/writer/print'
import {
  newWriterDocument,
  writerDirty,
  writerDocument,
  writerName,
  writerTitle
} from '@/app/writer/session'
import HistoryVersionDialog from '@/components/history/HistoryVersionDialog.vue'
import WriterHistoryPanel from '@/components/history/WriterHistoryPanel.vue'
import WriterHistoryPreview from '@/components/history/WriterHistoryPreview.vue'
import AppButton from '@/components/ui/button/AppButton.vue'
import IconButton from '@/components/ui/button/IconButton.vue'
import AppAlert from '@/components/ui/feedback/AppAlert.vue'
import AppInput from '@/components/ui/input/AppInput.vue'
import { writer } from '@/components/writer/ui'
import { useWriterEditor } from '@/components/writer/useWriterEditor'
import WriterFindBar from '@/components/writer/WriterFindBar.vue'
import WriterGoogleDocs from '@/components/writer/WriterGoogleDocs.vue'
import WriterNewMenu from '@/components/writer/WriterNewMenu.vue'
import WriterPageSetup from '@/components/writer/WriterPageSetup.vue'
import WriterPaper from '@/components/writer/WriterPaper.vue'
import WriterProtectDialog from '@/components/writer/WriterProtectDialog.vue'
import WriterRegion from '@/components/writer/WriterRegion.vue'
import WriterSendDialog from '@/components/writer/WriterSendDialog.vue'
import WriterSidePanel from '@/components/writer/WriterSidePanel.vue'
import WriterSignPDFDialog from '@/components/writer/WriterSignPDFDialog.vue'
import WriterToolbar from '@/components/writer/WriterToolbar.vue'
import WriterWordCount from '@/components/writer/WriterWordCount.vue'

const t = useWriterMessages()
const history = useHistoryMessages()
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
const findOpen = ref(false)
const signPDFOpen = ref(false)
const sendOpen = ref(false)
const protectOpen = ref(false)
const locked = ref(false)
const unlockPassword = ref('')
const sideTab = ref<'comments' | 'changes' | null>(null)
const historyOpen = ref(false)
/** The version shown in the document's place while the history is open, or null for now. */
const historyVersionId = ref<string | null>(null)
const historyMode = ref<'version' | 'compare'>('version')
const writerHistory = useWriterHistory()
const previewedVersion = computed(() =>
  historyOpen.value && historyVersionId.value
    ? writerHistory.versionDocument(historyVersionId.value)
    : null
)

function toggleHistory() {
  historyOpen.value = !historyOpen.value
  historyVersionId.value = null
  if (historyOpen.value) sideTab.value = null
}
const statistics = computed(() => documentStatistics(writerDocument.value.body))

function toggleSide(tab: 'comments' | 'changes') {
  sideTab.value = sideTab.value === tab ? null : tab
  if (sideTab.value) historyOpen.value = false
}
const error = ref<string | null>(null)
const statusLabel = computed(() => {
  if (busy.value) return t.value.saving
  return writerDirty.value ? t.value.unsaved : t.value.saved
})

function report(outcome: WriterFileOutcome, failed: (detail: string) => string) {
  locked.value = outcome.status === 'failed' && outcome.reason === 'encrypted'
  if (outcome.status !== 'failed') {
    error.value = null
    return
  }
  if (outcome.reason === 'not-docx') error.value = t.value.notDocx
  else if (outcome.reason === 'encrypted') error.value = t.value.encrypted
  else if (outcome.reason === 'wrong-password') error.value = t.value.wrongPassword
  else if (outcome.reason === 'invalid-google-doc') error.value = t.value.invalidGoogleDoc
  else if (outcome.reason === 'google')
    error.value = t.value.googleFailed({ error: outcome.detail })
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

/** Opens the print dialog on the document as it prints; its Save as PDF exports the PDF. */
async function printDocument() {
  const instance = editor.value
  if (!instance) return
  await printHTML(
    printableHTML(
      { ...writerDocument.value, title: writerTitle.value },
      {
        bodyHTML: instance.getHTML(),
        fontsStylesheet: WRITER_FONTS_STYLESHEET,
        footnotes: writerDocument.value.footnotes.map((note) =>
          note.content.map(nodeText).join(' ')
        )
      }
    )
  )
}

function createDocument(template: WriterTemplateId | null) {
  newWriterDocument(localeDirection(locale.value), template ? writerTemplate(template) : undefined)
}

function unlock() {
  const outcome = unlockWordDocument(unlockPassword.value)
  report(outcome, openFailed)
  if (outcome.status === 'failed' && outcome.reason === 'wrong-password') locked.value = true
  unlockPassword.value = ''
}

useEventListener(window, 'keydown', (event: KeyboardEvent) => {
  if (!(event.ctrlKey || event.metaKey)) return
  if (event.code === 'KeyF' || event.code === 'KeyH') {
    event.preventDefault()
    findOpen.value = true
    return
  }
  if (event.code !== 'KeyS') return
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
        <WriterNewMenu @create="createDocument" />
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
        <IconButton :label="t.exportPDF" data-test-id="writer-print" @click="printDocument">
          <icon-lucide-printer class="size-3.5" />
        </IconButton>
        <IconButton :label="t.signPDF" data-test-id="writer-sign-pdf" @click="signPDFOpen = true">
          <icon-lucide-file-badge class="size-3.5" />
        </IconButton>
        <IconButton
          :label="t.sendForSignature"
          data-test-id="writer-send-toggle"
          @click="sendOpen = true"
        >
          <icon-lucide-send class="size-3.5 rtl:-scale-x-100" />
        </IconButton>
        <WriterGoogleDocs
          @open="(link: string) => run(() => openGoogleDocument(link), openFailed)"
        />
        <WriterPageSetup />
        <IconButton
          :label="t.passwordProtection"
          data-test-id="writer-protect"
          @click="protectOpen = true"
        >
          <icon-lucide-lock-keyhole class="size-3.5" />
        </IconButton>
        <IconButton
          :label="t.findAndReplace"
          toggle
          :active="findOpen"
          data-test-id="writer-find-toggle"
          @click="findOpen = !findOpen"
        >
          <icon-lucide-search class="size-3.5" />
        </IconButton>
        <IconButton
          :label="t.comments"
          toggle
          :active="sideTab === 'comments'"
          data-test-id="writer-comments-toggle"
          @click="toggleSide('comments')"
        >
          <icon-lucide-message-square class="size-3.5" />
        </IconButton>
        <IconButton
          :label="t.trackChanges"
          toggle
          :active="sideTab === 'changes'"
          data-test-id="writer-changes-toggle"
          @click="toggleSide('changes')"
        >
          <icon-lucide-file-diff class="size-3.5" />
        </IconButton>
        <IconButton
          :label="history.panelTitle"
          toggle
          :active="historyOpen"
          data-test-id="writer-history-toggle"
          @click="toggleHistory"
        >
          <icon-lucide-history class="size-3.5" />
        </IconButton>
        <WriterWordCount :statistics="statistics" />
      </div>
    </div>
    <WriterToolbar v-if="editor" :editor="editor" />
    <WriterSignPDFDialog v-model:open="signPDFOpen" />
    <WriterSendDialog v-model:open="sendOpen" />
    <WriterProtectDialog v-model:open="protectOpen" />
    <HistoryVersionDialog />
    <WriterFindBar v-if="editor && findOpen" :editor="editor" @close="findOpen = false" />
    <AppAlert v-if="error" tone="error" :heading="error" class="m-2">
      <form v-if="locked" class="mt-2 flex gap-1.5" @submit.prevent="unlock">
        <AppInput
          v-model="unlockPassword"
          type="password"
          :aria-label="t.password"
          :placeholder="t.password"
          data-test-id="writer-unlock-password"
        />
        <AppButton size="sm" type="submit" :disabled="!unlockPassword">{{
          t.openEncrypted
        }}</AppButton>
      </form>
    </AppAlert>
    <div :class="ui.workspace()">
      <div :class="ui.scroller()">
        <WriterHistoryPreview
          v-if="previewedVersion"
          :version="previewedVersion"
          :mode="historyMode"
        />
        <WriterPaper
          v-if="editor"
          v-show="!previewedVersion"
          :editor="editor"
          :page="page"
          :watermark="writerDocument.watermark?.text"
        >
          <template #header><WriterRegion kind="header" /></template>
          <template #footer><WriterRegion kind="footer" /></template>
        </WriterPaper>
      </div>
      <WriterHistoryPanel
        v-if="historyOpen"
        v-model:selected="historyVersionId"
        v-model:mode="historyMode"
        @close="toggleHistory"
      />
      <WriterSidePanel
        v-else-if="editor && sideTab"
        :editor="editor"
        :tab="sideTab"
        @close="sideTab = null"
      />
    </div>
  </div>
</template>
