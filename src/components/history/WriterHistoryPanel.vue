<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'

import type { DocumentVersion } from '@lawha/cloud/contract'
import type { HistoryVersion } from '@lawha/core/history'
import { readDocx, writeDocx } from '@lawha/core/writer'
import { useHistoryMessages } from '@lawha/vue/i18n'

import { cloudWriterVersionBytes, cloudWriterVersions } from '@/app/cloud/integration'
import { openHistoryVersionDialog } from '@/app/history/dialog'
import { useWriterHistory } from '@/app/history/writer'
import { useDateFormat } from '@/app/i18n/date'
import { toast } from '@/app/shell/ui'
import { DOCX, saveFileAs } from '@/app/writer/files'
import { replaceWriterDocument, writerSource, writerTitle } from '@/app/writer/session'
import IconButton from '@/components/ui/button/IconButton.vue'
import PanelHeader from '@/components/ui/panel/PanelHeader.vue'

import HistoryTimeline from './HistoryTimeline.vue'
import { historyPanel } from './ui'

/**
 * The document editor's version history, beside the page: the same timeline as a design's,
 * with edits described by the paragraphs they touched.
 */
const selected = defineModel<string | null>('selected', { required: true })
const mode = defineModel<'version' | 'compare'>('mode', { required: true })
const emit = defineEmits<{ close: [] }>()

const t = useHistoryMessages()
const ui = historyPanel()
const history = useWriterHistory()
const current = computed(() => history.controller.history.value)
// The history object stays the same as it changes; reading the ref itself gives a new token.
const revision = computed(() => {
  void history.controller.history.value
  return {}
})

async function run(action: () => Promise<unknown> | unknown) {
  try {
    await action()
  } catch (error) {
    console.warn('[History] Changing the version history failed:', error)
    toast.error(t.value.changeFailed)
  }
}

function select(versionId: string | null) {
  selected.value = versionId
  mode.value = 'version'
}

function compare(version: HistoryVersion) {
  selected.value = version.id
  mode.value = 'compare'
}

const restore = (version: HistoryVersion) =>
  run(async () => {
    await history.restore(version.id)
    selected.value = null
    emit('close')
  })

/** A version saved as a Word file of its own, beside the document. */
const duplicate = (version: HistoryVersion) =>
  run(async () => {
    const document = history.versionDocument(version.id)
    const name = t.value.duplicateName({ name: writerTitle.value || document.title || 'Document' })
    await saveFileAs(writeDocx({ ...document, title: name }), name, DOCX)
  })

function edit(version: HistoryVersion | null) {
  openHistoryVersionDialog({
    version,
    save: ({ title, description }) =>
      version
        ? history.rename(version.id, { title, description })
        : history.saveNamed(title, description)
  })
}

const removeName = (version: HistoryVersion) =>
  run(() => history.rename(version.id, { title: null }))

/** The file's Cloud versions, one per save, when it is kept on a Cloud server. */
const cloudVersions = shallowRef<DocumentVersion[] | null>(null)
const dates = useDateFormat()
watch(
  writerSource,
  (source) => {
    cloudVersions.value = null
    if (source?.kind !== 'storage') return
    void cloudWriterVersions(source.binding)
      .then((versions) => {
        if (writerSource.value === source) cloudVersions.value = versions
        return versions
      })
      .catch((error: unknown) => console.warn('[History] Cloud versions failed to load:', error))
  },
  { immediate: true }
)

/** Brings a Cloud version back as the document; saving makes it the newest version. */
const openCloudVersion = (version: DocumentVersion) =>
  run(async () => {
    const source = writerSource.value
    if (source?.kind !== 'storage') return
    const document = readDocx(await cloudWriterVersionBytes(source.binding, version.id))
    replaceWriterDocument({ ...document, title: writerTitle.value || document.title })
    emit('close')
  })

// Edits made just before opening are listed at once.
history.flush()
void history.controller.refresh()
</script>

<template>
  <aside :class="ui.side()" :aria-label="t.panelTitle" data-slot="history-panel">
    <PanelHeader>
      <template #icon><icon-lucide-history class="size-3.5" /></template>
      {{ t.panelTitle }}
      <template #actions>
        <IconButton :label="t.saveVersion" @click="edit(null)">
          <icon-lucide-plus class="size-3.5" />
        </IconButton>
        <IconButton :label="t.close" @click="emit('close')">
          <icon-lucide-x class="size-3.5" />
        </IconButton>
      </template>
    </PanelHeader>
    <HistoryTimeline
      :history="current"
      :revision="revision"
      :selected-id="selected"
      unit="paragraphs"
      @select="select"
      @restore="restore"
      @compare="compare"
      @duplicate="duplicate"
      @edit="edit"
      @remove-name="removeName"
    />
    <section
      v-if="cloudVersions?.length"
      :aria-label="t.cloudVersions"
      class="flex flex-col gap-1 border-t border-border p-2 text-xs"
      data-slot="writer-cloud-versions"
    >
      <h3 class="font-semibold text-surface">{{ t.cloudVersions }}</h3>
      <button
        v-for="version in cloudVersions"
        :key="version.id"
        type="button"
        class="flex flex-col items-start rounded px-1.5 py-1 text-start hover:bg-hover"
        :data-current="version.current ? '' : undefined"
        @click="openCloudVersion(version)"
      >
        <span class="text-surface">{{
          version.name ?? dates.format(version.createdAt, 'dateTime')
        }}</span>
        <span class="text-muted">{{ version.createdBy.name ?? '' }}</span>
      </button>
    </section>
  </aside>
</template>
