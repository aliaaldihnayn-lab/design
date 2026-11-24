<script setup lang="ts">
import { useElementSize } from '@vueuse/core'
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuTrigger,
  TabsContent,
  TabsList,
  TabsRoot,
  TabsTrigger
} from 'reka-ui'
import { tv } from 'tailwind-variants'
import { computed, shallowRef, type Component } from 'vue'
import BookOpen from '~icons/lucide/book-open'
import CodeXML from '~icons/lucide/code-xml'
import Download from '~icons/lucide/download'
import Ellipsis from '~icons/lucide/ellipsis'
import MonitorSmartphone from '~icons/lucide/monitor-smartphone'
import Play from '~icons/lucide/play'
import SlidersHorizontal from '~icons/lucide/sliders-horizontal'
import Sparkles from '~icons/lucide/sparkles'
import SwatchBook from '~icons/lucide/swatch-book'

import { resolveEditorProfile } from '@lawha/core'
import {
  useDesignCheckMessages,
  useI18n,
  useInspectMessages,
  useStoriesMessages
} from '@lawha/vue/i18n'
import { useSceneComputed } from '@lawha/vue/internal/scene-computed'

import { isVersionHistoryOpen } from '@/app/cloud/integration'
import { useEditorStore } from '@/app/editor/active-store'
import { countIssues } from '@/app/editor/design-check/issues'
import { describePanelSelection } from '@/app/editor/properties-panel/selection'
import { devView, propertiesTab } from '@/app/editor/properties-panel/state'
import {
  shownDevView,
  shownTab,
  splitTabRow,
  visibleTabs,
  type DevView,
  type PropertiesTab,
  type SectionTab
} from '@/app/editor/properties-panel/tabs'
import { isLocalHistoryOpen } from '@/app/history/panel'
import ChatPanel from '@/components/chat/ChatPanel.vue'
import { CloudVersionHistory } from '@/components/cloud/integration'
import HistoryPanel from '@/components/history/HistoryPanel.vue'
import { menuItem, useMenuUI } from '@/components/ui/menu/menu'
import Tip from '@/components/ui/overlay/Tip.vue'
import propertiesTabsTheme, { PROPERTIES_ICON_TAB_WIDTH } from '@/theme/panel/properties-tabs'

import CodePanel from './CodePanel.vue'
import CommentsPanel from './comments/CommentsPanel.vue'
import DesignCheckPanel from './design-check/DesignCheckPanel.vue'
import DesignPanel from './DesignPanel.vue'
import ZoomDropdown from './editor/ZoomDropdown.vue'
import InspectPanel from './inspect/InspectPanel.vue'
import StoriesPanel from './stories/StoriesPanel.vue'

const propertiesTabs = tv(propertiesTabsTheme)
/** The row's horizontal padding, which the tabs cannot use. */
const TAB_ROW_PADDING = 16

const { panels } = useI18n()
const checkMessages = useDesignCheckMessages()
const inspectMessages = useInspectMessages()
const storiesMessages = useStoriesMessages()
const store = useEditorStore()

const tabStyles = propertiesTabs()
const menuCls = useMenuUI({ content: 'min-w-40' })
const itemCls = menuItem({ justify: 'start' })
/** The Comment tool turns the sidebar into the comments list, as in Figma; the tabs keep their state. */
const commenting = computed(() => store.state.activeTool === 'COMMENT')
/** Version history takes the sidebar while it is open, for the document and a version alike. */
const cloudHistory = computed(() => isVersionHistoryOpen(store))
const localHistory = computed(() => isLocalHistoryOpen(store))
const history = computed(() => cloudHistory.value || localHistory.value)

/** Whether the document has design lint: a board has none, as FigJam has none. */
const lints = computed(() => resolveEditorProfile(store.state).lint)

/**
 * Enough of the selection to decide which tabs apply. The Design panel derives its sections from
 * the same description, so a tab is shown exactly when it has a section to draw.
 */
const selection = useSceneComputed(() =>
  describePanelSelection(store.graph, store.getSelectedNodes(), store.state.activeTool === 'FRAME')
)
const visible = computed(() => visibleTabs(selection.value))

/** The tab drawn: the last one chosen while it applies, Design otherwise. */
const activeTab = computed<string>({
  get: () => shownTab(propertiesTab.value, visible.value),
  set: (tab) => {
    const next = visible.value.find((candidate) => candidate === tab)
    if (next) propertiesTab.value = next
  }
})
const activeDevView = computed<string>({
  get: () => shownDevView(devView.value, lints.value),
  set: (view) => {
    const next = devViews.value.find((candidate) => candidate.value === view)
    if (next) devView.value = next.value
  }
})

/** Errors and warnings on the current page; suggestions do not earn an indicator. */
const problemCount = computed(() => {
  const snapshot = store.designCheck.snapshot.value
  if (!snapshot || snapshot.pageId !== store.state.currentPageId) return null
  const counts = countIssues(snapshot.issues)
  return { total: counts.error + counts.warning, severity: counts.error > 0 ? 'error' : 'warning' }
})

interface TabEntry {
  value: PropertiesTab
  label: string
  icon: Component
  /** What a screen reader hears, when it says more than the label. */
  ariaLabel?: string
  severity?: string
}

const TAB_ICONS: Record<PropertiesTab, Component> = {
  design: SlidersHorizontal,
  prototype: Play,
  adapt: MonitorSmartphone,
  system: SwatchBook,
  export: Download,
  dev: CodeXML,
  stories: BookOpen,
  ai: Sparkles
}

const tabLabels = computed<Record<PropertiesTab, string>>(() => ({
  design: panels.value.design,
  prototype: panels.value.tabPrototype,
  adapt: panels.value.tabAdapt,
  system: panels.value.tabSystem,
  export: panels.value.tabExport,
  dev: panels.value.tabDev,
  stories: storiesMessages.value.tab,
  ai: panels.value.ai
}))

const tabs = computed<TabEntry[]>(() =>
  visible.value.map((value) => {
    const entry: TabEntry = { value, label: tabLabels.value[value], icon: TAB_ICONS[value] }
    // Lint's errors and warnings tint the Dev icon, which costs no room in a full row.
    if (value === 'dev' && lints.value && problemCount.value?.total) {
      entry.severity = problemCount.value.severity
      entry.ariaLabel = `${entry.label}, ${checkMessages.value.tabCount({ count: problemCount.value.total })}`
    }
    return entry
  })
)

const devViews = computed<Array<{ value: DevView; label: string }>>(() => [
  { value: 'inspect', label: inspectMessages.value.tab },
  { value: 'code', label: panels.value.code },
  ...(lints.value ? [{ value: 'lint' as const, label: checkMessages.value.tab }] : [])
])

const list = shallowRef<HTMLElement>()
const activeTrigger = shallowRef<HTMLElement>()
const zoom = shallowRef<HTMLElement>()
const { width: listWidth } = useElementSize(list, undefined, { box: 'border-box' })
const { width: activeWidth } = useElementSize(activeTrigger, undefined, { box: 'border-box' })
const { width: zoomWidth } = useElementSize(zoom, undefined, { box: 'border-box' })

const row = computed(() => {
  const active = tabs.value.find((tab) => tab.value === activeTab.value) ?? tabs.value[0]
  return splitTabRow(tabs.value, active, {
    available: listWidth.value > 0 ? listWidth.value - TAB_ROW_PADDING - zoomWidth.value : 0,
    active: activeWidth.value + 2,
    icon: PROPERTIES_ICON_TAB_WIDTH
  })
})

function setTrigger(tab: PropertiesTab, element: unknown) {
  if (tab === activeTab.value && element instanceof HTMLElement) activeTrigger.value = element
}

function triggerElement(value: unknown): HTMLElement | undefined {
  if (value instanceof HTMLElement) return value
  if (value && typeof value === 'object' && '$el' in value && value.$el instanceof HTMLElement)
    return value.$el
  return undefined
}

const sectionTabs: SectionTab[] = ['design', 'prototype', 'adapt', 'system', 'export']
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
      <div ref="list" class="shrink-0">
        <TabsList :aria-label="panels.propertiesTabs" :class="tabStyles.list()">
          <Tip
            v-for="tab in row.inline"
            :key="tab.value"
            :label="tab.label"
            :disabled="tab.value === activeTab"
          >
            <TabsTrigger
              :ref="(el) => setTrigger(tab.value, triggerElement(el))"
              :value="tab.value"
              :data-test-id="`properties-tab-${tab.value}`"
              :aria-label="tab.ariaLabel"
              :class="tabStyles.trigger()"
            >
              <component
                :is="tab.icon"
                :data-severity="tab.severity"
                :class="tabStyles.icon()"
                aria-hidden="true"
              />
              <span :class="tabStyles.label()">{{ tab.label }}</span>
            </TabsTrigger>
          </Tip>
          <DropdownMenuRoot v-if="row.overflow.length > 0">
            <Tip :label="panels.moreTabs">
              <DropdownMenuTrigger
                data-test-id="properties-tab-more"
                :aria-label="panels.moreTabs"
                :class="tabStyles.more()"
              >
                <Ellipsis class="size-3.5" aria-hidden="true" />
              </DropdownMenuTrigger>
            </Tip>
            <DropdownMenuPortal>
              <DropdownMenuContent
                side="bottom"
                align="end"
                :side-offset="4"
                :class="menuCls.content"
              >
                <DropdownMenuItem
                  v-for="tab in row.overflow"
                  :key="tab.value"
                  :data-test-id="`properties-tab-${tab.value}`"
                  :aria-label="tab.ariaLabel"
                  :class="itemCls"
                  @select="activeTab = tab.value"
                >
                  <component
                    :is="tab.icon"
                    :data-severity="tab.severity"
                    :class="tabStyles.icon()"
                    aria-hidden="true"
                  />
                  {{ tab.label }}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenuPortal>
          </DropdownMenuRoot>
          <span v-if="activeTab === 'design'" ref="zoom" :class="tabStyles.zoom()">
            <ZoomDropdown />
          </span>
        </TabsList>
      </div>

      <!-- Design keeps its retained selection subtree while another tab is shown. -->
      <TabsContent
        v-for="tab in sectionTabs"
        :key="tab"
        :value="tab"
        :data-test-id="`properties-content-${tab}`"
        :class="tabStyles.content()"
        :force-mount="tab === 'design'"
        :hidden="activeTab !== tab"
      >
        <DesignPanel :tab="tab" />
      </TabsContent>

      <TabsContent
        value="dev"
        data-test-id="properties-content-dev"
        :class="tabStyles.content()"
        :force-mount="true"
        :hidden="activeTab !== 'dev'"
      >
        <TabsRoot v-model="activeDevView" :class="tabStyles.content()">
          <TabsList :aria-label="panels.tabDev" :class="tabStyles.subList()">
            <TabsTrigger
              v-for="view in devViews"
              :key="view.value"
              :value="view.value"
              :data-test-id="`dev-tab-${view.value}`"
              :class="tabStyles.subTrigger()"
            >
              <span>{{ view.label }}</span>
              <icon-lucide-circle
                v-if="view.value === 'lint' && problemCount?.total"
                :data-severity="problemCount.severity"
                class="size-1.5 fill-current data-[severity=error]:text-error data-[severity=warning]:text-warning"
                aria-hidden="true"
              />
            </TabsTrigger>
          </TabsList>
          <TabsContent value="inspect" :class="tabStyles.content()">
            <InspectPanel :active="activeTab === 'dev' && activeDevView === 'inspect'" />
          </TabsContent>
          <TabsContent
            value="code"
            :class="tabStyles.content()"
            :force-mount="true"
            :hidden="activeDevView !== 'code'"
          >
            <CodePanel :active="activeTab === 'dev' && activeDevView === 'code'" />
          </TabsContent>
          <TabsContent
            v-if="lints"
            value="lint"
            :class="tabStyles.content()"
            :force-mount="true"
            :hidden="activeDevView !== 'lint'"
          >
            <DesignCheckPanel :active="activeTab === 'dev' && activeDevView === 'lint'" />
          </TabsContent>
        </TabsRoot>
      </TabsContent>

      <TabsContent value="stories" :class="tabStyles.content()" :hidden="activeTab !== 'stories'">
        <StoriesPanel :active="activeTab === 'stories'" />
      </TabsContent>

      <TabsContent
        value="ai"
        :class="tabStyles.content()"
        :force-mount="true"
        :hidden="activeTab !== 'ai'"
      >
        <ChatPanel />
      </TabsContent>
    </TabsRoot>
  </aside>
</template>
