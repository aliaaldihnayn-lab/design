<script setup lang="ts">
import { SplitterGroup, SplitterPanel, SplitterResizeHandle } from 'reka-ui'
import { tv } from 'tailwind-variants'
import { computed, ref } from 'vue'

import { useI18n, usePageMessages } from '@lawha/vue/i18n'
import { vTestId } from '@lawha/vue/testing'

import AppMenu from '@/components/shell/AppMenu.vue'
import SegmentedControl from '@/components/ui/select/SegmentedControl.vue'
import splitterTheme from '@/theme/splitter'

import AssetsPanel from './assets-panel/AssetsPanel.vue'
import LayerTree from './LayerTree/LayerTree.vue'
import PagesPanel from './PagesPanel.vue'
import PublicationPanel from './publication/PublicationPanel.vue'

const { menu, panels } = useI18n()
const pageMessages = usePageMessages()
type LeftPanel = 'file' | 'assets' | 'publication'
const activePanel = ref<LeftPanel>('file')
const panelModel = computed({
  get: () => activePanel.value,
  set: (value: string) => {
    if (value === 'file' || value === 'assets' || value === 'publication') activePanel.value = value
  }
})
const panelOptions = computed(() => [
  { value: 'file', label: menu.value.file },
  { value: 'assets', label: panels.value.assets },
  { value: 'publication', label: pageMessages.value.publication }
])
const PANEL_TAB_TEST_IDS: Record<string, string> = {
  file: 'left-panel-layers-tab',
  assets: 'left-panel-assets-tab',
  publication: 'left-panel-publication-tab'
}
const panelTabsUI = { root: 'w-full' }
const splitterStyles = tv(splitterTheme)({ direction: 'vertical' })
</script>

<template>
  <aside
    data-test-id="layers-panel"
    class="flex min-w-0 flex-1 flex-col overflow-hidden border-r border-border bg-panel"
    style="contain: paint layout style"
  >
    <AppMenu />
    <div class="shrink-0 border-b border-border px-2 py-1.5">
      <SegmentedControl
        v-model="panelModel"
        :options="panelOptions"
        :label="panels.layers"
        :ui="panelTabsUI"
      >
        <template #option="{ option }">
          <span v-test-id="PANEL_TAB_TEST_IDS[option.value]" class="truncate">
            {{ option.label }}
          </span>
        </template>
      </SegmentedControl>
    </div>
    <AssetsPanel v-if="activePanel === 'assets'" />
    <PublicationPanel v-else-if="activePanel === 'publication'" />
    <SplitterGroup
      v-else
      direction="vertical"
      auto-save-id="layers-layout"
      class="flex-1 overflow-hidden"
    >
      <SplitterPanel
        :default-size="30"
        :min-size="10"
        :max-size="60"
        class="flex flex-col overflow-hidden"
      >
        <PagesPanel />
      </SplitterPanel>
      <SplitterResizeHandle :class="splitterStyles.handle()">
        <div :class="splitterStyles.divider()" />
      </SplitterResizeHandle>
      <SplitterPanel :default-size="70" :min-size="20" class="flex flex-col overflow-hidden">
        <header
          data-test-id="layers-header"
          class="shrink-0 px-3 py-2 text-[11px] font-semibold text-surface"
        >
          {{ panels.layers }}
        </header>
        <LayerTree data-test-id="layers-tree" />
      </SplitterPanel>
    </SplitterGroup>
  </aside>
</template>
