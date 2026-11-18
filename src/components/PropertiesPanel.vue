<script setup lang="ts">
import { TabsContent, TabsList, TabsRoot, TabsTrigger } from 'reka-ui'
import { tv } from 'tailwind-variants'
import { computed, watchEffect } from 'vue'

import { resolveEditorProfile } from '@lawha/core'
import {
  useDesignCheckMessages,
  useI18n,
  useInspectMessages,
  useStoriesMessages
} from '@lawha/vue/i18n'

import { useAIChat } from '@/app/ai/chat/use'
import { isVersionHistoryOpen } from '@/app/cloud/integration'
import { useEditorStore } from '@/app/editor/active-store'
import { countIssues } from '@/app/editor/design-check/issues'
import { isLocalHistoryOpen } from '@/app/history/panel'
import ChatPanel from '@/components/chat/ChatPanel.vue'
import { CloudVersionHistory } from '@/components/cloud/integration'
import HistoryPanel from '@/components/history/HistoryPanel.vue'
import propertiesTabsTheme from '@/theme/panel/properties-tabs'

import CodePanel from './CodePanel.vue'
import CommentsPanel from './comments/CommentsPanel.vue'
import DesignCheckPanel from './design-check/DesignCheckPanel.vue'
import DesignPanel from './DesignPanel.vue'
import ZoomDropdown from './editor/ZoomDropdown.vue'
import InspectPanel from './inspect/InspectPanel.vue'
import StoriesPanel from './stories/StoriesPanel.vue'

const propertiesTabs = tv(propertiesTabsTheme)

const { activeTab } = useAIChat()
const { panels } = useI18n()
const checkMessages = useDesignCheckMessages()
const inspectMessages = useInspectMessages()
const storiesMessages = useStoriesMessages()
const store = useEditorStore()

const tabStyles = propertiesTabs()
/** The Comment tool turns the sidebar into the comments list, as in Figma; the tabs keep their state. */
const commenting = computed(() => store.state.activeTool === 'COMMENT')
/** Version history takes the sidebar while it is open, for the document and a version alike. */
const cloudHistory = computed(() => isVersionHistoryOpen(store))
const localHistory = computed(() => isLocalHistoryOpen(store))
const history = computed(() => cloudHistory.value || localHistory.value)

/** Whether the document has design lint: a board has none, as FigJam has none. */
const lints = computed(() => resolveEditorProfile(store.state).lint)
// A board opened on the Lint tab shows Design instead.
watchEffect(() => {
  if (!lints.value && activeTab.value === 'lint') activeTab.value = 'design'
})

/** Errors and warnings on the current page; suggestions do not earn an indicator. */
const problemCount = computed(() => {
  const snapshot = store.designCheck.snapshot.value
  if (!snapshot || snapshot.pageId !== store.state.currentPageId) return null
  const counts = countIssues(snapshot.issues)
  return { total: counts.error + counts.warning, severity: counts.error > 0 ? 'error' : 'warning' }
})
</script>

<template>
  <aside
    data-test-id="properties-panel"
    class="flex min-w-0 flex-1 flex-col overflow-hidden border-l border-border bg-panel"
    style="contain: paint layout style"
  >
    <CloudVersionHistory v-if="cloudHistory" />
    <HistoryPanel v-else-if="localHistory" />
    <CommentsPanel v-else-if="commenting" />
    <TabsRoot
      v-show="!commenting && !history"
      v-model="activeTab"
      class="flex min-h-0 flex-1 flex-col"
    >
      <TabsList :class="tabStyles.list()">
        <TabsTrigger
          value="design"
          data-test-id="properties-tab-design"
          :class="tabStyles.trigger()"
        >
          {{ panels.design }}
        </TabsTrigger>
        <TabsTrigger
          value="inspect"
          data-test-id="properties-tab-inspect"
          :class="tabStyles.trigger()"
        >
          <icon-lucide-ruler :class="tabStyles.icon()" aria-hidden="true" />
          <span :class="tabStyles.label()">{{ inspectMessages.tab }}</span>
        </TabsTrigger>
        <TabsTrigger value="code" data-test-id="properties-tab-code" :class="tabStyles.trigger()">
          <icon-lucide-code :class="tabStyles.icon()" aria-hidden="true" />
          <span :class="tabStyles.label()">{{ panels.code }}</span>
        </TabsTrigger>
        <TabsTrigger
          value="stories"
          data-test-id="properties-tab-stories"
          :class="tabStyles.trigger()"
        >
          <icon-lucide-book-open :class="tabStyles.icon()" aria-hidden="true" />
          <span :class="tabStyles.label()">{{ storiesMessages.tab }}</span>
        </TabsTrigger>
        <TabsTrigger value="ai" data-test-id="properties-tab-ai" :class="tabStyles.trigger()">
          <icon-lucide-sparkles :class="tabStyles.icon()" aria-hidden="true" />
          <span :class="tabStyles.label()">{{ panels.ai }}</span>
        </TabsTrigger>
        <TabsTrigger
          v-if="lints"
          value="lint"
          data-test-id="properties-tab-lint"
          :aria-label="
            problemCount?.total
              ? `${checkMessages.tab}, ${checkMessages.tabCount({ count: problemCount.total })}`
              : checkMessages.tab
          "
          :class="tabStyles.trigger()"
        >
          <!-- Errors and warnings tint the icon, which costs no room in a full row. -->
          <icon-lucide-list-checks
            :data-severity="problemCount?.total ? problemCount.severity : undefined"
            :class="tabStyles.icon()"
            aria-hidden="true"
          />
          <span :class="tabStyles.label()">{{ checkMessages.tab }}</span>
        </TabsTrigger>
        <ZoomDropdown v-if="activeTab === 'design'" />
      </TabsList>

      <TabsContent
        value="design"
        class="flex min-h-0 flex-1 flex-col"
        :force-mount="true"
        :hidden="activeTab !== 'design'"
      >
        <DesignPanel />
      </TabsContent>

      <TabsContent
        value="inspect"
        class="flex min-h-0 flex-1 flex-col"
        :hidden="activeTab !== 'inspect'"
      >
        <InspectPanel :active="activeTab === 'inspect'" />
      </TabsContent>

      <TabsContent
        value="code"
        class="flex min-h-0 flex-1 flex-col"
        :force-mount="true"
        :hidden="activeTab !== 'code'"
      >
        <CodePanel :active="activeTab === 'code'" />
      </TabsContent>

      <TabsContent
        value="stories"
        class="flex min-h-0 flex-1 flex-col"
        :hidden="activeTab !== 'stories'"
      >
        <StoriesPanel :active="activeTab === 'stories'" />
      </TabsContent>

      <TabsContent
        value="lint"
        class="flex min-h-0 flex-1 flex-col"
        :force-mount="true"
        :hidden="activeTab !== 'lint'"
      >
        <DesignCheckPanel :active="activeTab === 'lint'" />
      </TabsContent>

      <TabsContent
        value="ai"
        class="flex min-h-0 flex-1 flex-col"
        :force-mount="true"
        :hidden="activeTab !== 'ai'"
      >
        <ChatPanel />
      </TabsContent>
    </TabsRoot>
  </aside>
</template>
