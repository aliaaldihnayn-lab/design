<script setup lang="ts">
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuTrigger
} from 'reka-ui'
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'

import { readNodeStories } from '@lawha/scene-graph/stories'
import { useStoriesMessages } from '@lawha/vue/i18n'

import { useEditorStore } from '@/app/editor/active-store'
import { showStoryPins, useStories } from '@/app/stories/use'
import AppButton from '@/components/ui/button/AppButton.vue'
import IconButton from '@/components/ui/button/IconButton.vue'
import AppAlert from '@/components/ui/feedback/AppAlert.vue'
import AppPlaceholder from '@/components/ui/feedback/AppPlaceholder.vue'
import { useMenuUI } from '@/components/ui/menu/menu'

import StoriesPanelDraft from './StoriesPanelDraft.vue'
import StoriesPanelEpics from './StoriesPanelEpics.vue'
import StoriesPanelJira from './StoriesPanelJira.vue'
import StoriesPanelStory from './StoriesPanelStory.vue'
import { stories as storiesTheme } from './ui'

/**
 * The Stories tab: the user stories of the selected frame or element, each one editable, and
 * the epics of the page with their stories. Export writes the selection's stories, or the page's
 * when nothing is selected, as Markdown or CSV.
 */
const { active = true } = defineProps<{ active?: boolean }>()

const store = useEditorStore()
const stories = useStories()
const t = useStoriesMessages()
const ui = storiesTheme()
const menuCls = useMenuUI({ content: 'min-w-40' })
const list = useTemplateRef<HTMLElement>('list')
const exportFailed = ref(false)

const selectionCount = computed(() => store.state.selectedIds.size)
const selectedNode = computed(() => {
  void store.state.sceneVersion
  const id = stories.selectedNodeId.value
  return id ? store.graph.getNode(id) : undefined
})

/**
 * An instance starts without its main component's stories, which describe the component; it
 * offers them, copied as its own, while it has none.
 */
const mainStoryCount = computed(() => {
  const node = selectedNode.value
  if (node?.type !== 'INSTANCE' || !node.componentId) return 0
  if (stories.selectedStories.value.length > 0) return 0
  return readNodeStories(store.graph.getNode(node.componentId)).length
})

function copyMainStories() {
  const node = selectedNode.value
  if (node) store.copyMainComponentStories(node.id)
}

function addStory() {
  const id = stories.selectedNodeId.value
  if (!id) return
  const story = store.addUserStory(id)
  stories.focusedStoryId.value = story.id
}

// A story opened from a pin or the epics list scrolls into view once its card is drawn.
watch(
  () => [stories.focusedStoryId.value, active] as const,
  async ([storyId, shown]) => {
    if (!storyId || !shown) return
    await nextTick()
    list.value
      ?.querySelector(`[data-story-id="${CSS.escape(storyId)}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  },
  { immediate: true }
)

async function exportAs(formatId: 'stories-markdown' | 'stories-csv') {
  exportFailed.value = false
  const ids = [...store.state.selectedIds]
  try {
    await store.exportTargets([
      {
        target:
          ids.length > 0
            ? { scope: 'selection', nodeIds: ids }
            : { scope: 'page', pageId: store.state.currentPageId },
        formatId
      }
    ])
  } catch {
    exportFailed.value = true
  }
}
</script>

<template>
  <div ref="list" :class="ui.panel()" data-test-id="stories-panel">
    <header :class="ui.header()">
      <span :class="ui.headerTitle()" dir="auto">{{ selectedNode?.name ?? t.userStories }}</span>
      <IconButton
        :label="t.showPins"
        toggle
        :active="showStoryPins"
        data-action="toggle-pins"
        @click="showStoryPins = !showStoryPins"
      >
        <icon-lucide-map-pin class="size-3.5" />
      </IconButton>
      <DropdownMenuRoot :modal="false">
        <DropdownMenuTrigger as-child>
          <IconButton :label="t.export" data-action="export-stories">
            <icon-lucide-download class="size-3.5" />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuPortal>
          <DropdownMenuContent :class="menuCls.content" align="end">
            <DropdownMenuItem :class="menuCls.item" @select="exportAs('stories-markdown')">
              {{ t.exportMarkdown }}
            </DropdownMenuItem>
            <DropdownMenuItem :class="menuCls.item" @select="exportAs('stories-csv')">
              {{ t.exportCSV }}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenuPortal>
      </DropdownMenuRoot>
    </header>

    <section v-if="selectedNode" :class="ui.section()" data-slot="layer-stories">
      <div :class="ui.sectionTitle()">
        <span class="flex-1">{{ t.stories(stories.selectedStories.value.length) }}</span>
        <AppButton variant="outline" size="xs" data-action="add-story" @click="addStory">
          <icon-lucide-plus class="size-3" aria-hidden="true" />
          {{ t.addStory }}
        </AppButton>
      </div>
      <p v-if="stories.selectedStories.value.length === 0" class="text-[11px] text-muted">
        {{ t.noStories }}
      </p>
      <AppButton
        v-if="mainStoryCount > 0"
        variant="outline"
        size="xs"
        data-action="copy-main-stories"
        @click="copyMainStories"
      >
        <icon-lucide-copy class="size-3" aria-hidden="true" />
        {{ t.copyMainComponentStories(mainStoryCount) }}
      </AppButton>
      <StoriesPanelStory
        v-for="story in stories.selectedStories.value"
        :key="story.id"
        :node-id="selectedNode.id"
        :story="story"
        :epics="stories.epics.value"
        :focused="stories.focusedStoryId.value === story.id"
      />
    </section>
    <StoriesPanelDraft v-if="selectedNode" :node-id="selectedNode.id" />
    <AppPlaceholder
      v-else
      size="compact"
      :fill="false"
      :label="t.userStories"
      :description="selectionCount > 1 ? t.multipleSelected : t.noSelection"
    />

    <StoriesPanelJira :node-ids="[...store.state.selectedIds]" />
    <StoriesPanelEpics :groups="stories.pageGroups.value" />

    <div v-if="exportFailed" class="px-3 py-2">
      <AppAlert tone="error" :heading="t.exportFailed" />
    </div>
  </div>
</template>
