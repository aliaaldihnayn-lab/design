<script setup lang="ts">
import { computed } from 'vue'

import type { HistoryVersion } from '@lawha/core/history'
import { useHistoryMessages } from '@lawha/vue/i18n'

import { useEditorStore } from '@/app/editor/active-store'
import {
  closeLocalHistory,
  compareLocalVersion,
  duplicateLocalVersion,
  endLocalComparison,
  localHistoryOf,
  localHistorySession,
  openLocalVersionDialog,
  previewLocalVersion,
  renameLocalVersion,
  restoreLocalVersion,
  showCurrentLocalVersion
} from '@/app/history/panel'
import { useDateFormat } from '@/app/i18n/date'
import { toast } from '@/app/shell/ui'
import IconButton from '@/components/ui/button/IconButton.vue'
import PanelHeader from '@/components/ui/panel/PanelHeader.vue'

import HistoryTimeline from './HistoryTimeline.vue'
import { historyPanel } from './ui'

/**
 * A design's version history, in the right sidebar while it is open: every edit by session and
 * every version, kept on this device. Choosing a version shows it read-only on the canvas.
 */
const shown = useEditorStore()
const t = useHistoryMessages()
const ui = historyPanel()
const dates = useDateFormat()

const state = computed(() => localHistoryOf(shown))
const session = computed(() => localHistorySession(shown))
const history = computed(() => session.value?.controller.history.value ?? null)
// The history object stays the same as it changes; a new token lists it again.
const revision = computed(() => (history.value ? {} : null))
const selectedId = computed(() => state.value?.preview?.versionId ?? null)
const comparison = computed(() => state.value?.comparison ?? null)

async function run(action: () => unknown) {
  try {
    await action()
  } catch (error) {
    console.warn('[History] Changing the version history failed:', error)
    toast.error(t.value.changeFailed)
  }
}

function select(versionId: string | null) {
  if (versionId === null) {
    showCurrentLocalVersion(shown)
    return
  }
  void run(async () => {
    await previewLocalVersion(shown, versionId)
    const version = history.value?.getVersion(versionId)
    const name = version?.title ?? (version ? dates.timeOrDay(version.at) : '')
    toast.info(t.value.viewing({ name }))
  })
}

const restore = (version: HistoryVersion) => run(() => restoreLocalVersion(shown, version.id))
const compare = (version: HistoryVersion) => run(() => compareLocalVersion(shown, version.id))
const duplicate = (version: HistoryVersion) =>
  run(() => {
    const document = state.value?.store ?? shown
    duplicateLocalVersion(
      shown,
      version.id,
      t.value.duplicateName({ name: document.state.documentName })
    )
  })
const removeName = (version: HistoryVersion) =>
  run(() => renameLocalVersion(shown, version.id, { title: null }))
</script>

<template>
  <section :class="ui.panel()" :aria-label="t.panelTitle" data-slot="history-panel">
    <PanelHeader>
      <template #icon><icon-lucide-history class="size-3.5" /></template>
      {{ t.panelTitle }}
      <template #actions>
        <IconButton :label="t.saveVersion" @click="openLocalVersionDialog(shown)">
          <icon-lucide-plus class="size-3.5" />
        </IconButton>
        <IconButton :label="t.close" @click="closeLocalHistory(shown)">
          <icon-lucide-x class="size-3.5" />
        </IconButton>
      </template>
    </PanelHeader>
    <HistoryTimeline
      v-if="history"
      :history="history"
      :revision="revision"
      :selected-id="selectedId"
      @select="select"
      @restore="restore"
      @compare="compare"
      @duplicate="duplicate"
      @edit="(version) => openLocalVersionDialog(shown, version)"
      @remove-name="removeName"
    />
    <section
      v-if="comparison"
      :class="ui.comparison()"
      :aria-label="t.comparing"
      data-slot="history-comparison"
    >
      <header :class="ui.comparisonHeader()">
        <span>{{ t.comparing }}</span>
        <IconButton :label="t.endComparison" @click="endLocalComparison(shown)">
          <icon-lucide-x class="size-3.5" />
        </IconButton>
      </header>
      <p v-if="comparison.layers.length === 0" :class="ui.status()">{{ t.comparisonEmpty }}</p>
      <ul v-else :class="ui.comparisonList()">
        <li
          v-for="layer in comparison.layers"
          :key="layer.id"
          :class="ui.comparisonRow()"
          :data-change="layer.change"
          data-slot="history-compared-layer"
        >
          <span :class="ui.badge()" :data-change="layer.change">{{ t[layer.change] }}</span>
          <span class="min-w-0 truncate">{{ layer.name || t.unnamedLayer }}</span>
        </li>
      </ul>
    </section>
  </section>
</template>
