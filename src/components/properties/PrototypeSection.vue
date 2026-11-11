<script setup lang="ts">
import { computed, ref } from 'vue'

import {
  SCROLL_DIRECTIONS,
  changeDestinations,
  readFlows,
  readInteractions,
  readScroll,
  screenOf,
  screensOf,
  type Action,
  type Interaction,
  type ScrollDirection
} from '@lawha/core/prototype'
import { ALL_TOOLS, type ToolDef } from '@lawha/core/tools'
import { usePrototypeMessages } from '@lawha/vue/i18n'

import { runEditorTool } from '@/app/ai/tools/runner'
import { makeFigmaFromStore } from '@/app/automation/bridge/figma-factory'
import { useEditorStore } from '@/app/editor/active-store'
import { showPrototypeConnections } from '@/app/prototype/connections'
import { openPlayer } from '@/app/prototype/player'
import { toast } from '@/app/shell/ui'
import AppButton from '@/components/ui/button/AppButton.vue'
import IconButton from '@/components/ui/button/IconButton.vue'
import Tip from '@/components/ui/overlay/Tip.vue'
import PanelSection from '@/components/ui/panel/PanelSection.vue'
import AppSelect from '@/components/ui/select/AppSelect.vue'

import { DEFAULT_TRANSITION, optionLabel } from './prototype/interaction'
import PrototypeSectionInteraction from './PrototypeSectionInteraction.vue'

const { nodeId = null } = defineProps<{ nodeId?: string | null }>()

const store = useEditorStore()
const t = usePrototypeMessages()
const busy = ref(false)

const pageId = computed(() => store.state.currentPageId)
// Re-read after every edit: the graph is not reactive, the scene version is.
const version = computed(() => store.state.sceneVersion)

const screens = computed(() => {
  void version.value
  return screensOf(store.graph, pageId.value)
})

const interactions = computed<Interaction[]>(() => {
  void version.value
  const node = nodeId ? store.graph.getNode(nodeId) : null
  return node ? readInteractions(node, store.graph) : []
})

/** Where Present starts: the selected screen, else the first flow, else the first screen. */
const startScreen = computed(() => {
  void version.value
  if (nodeId) {
    const own = screenOf(store.graph, nodeId, pageId.value)
    if (own) return own.id
  }
  const page = store.graph.getNode(pageId.value)
  return (page ? readFlows(page)[0]?.start : undefined) ?? screens.value[0]?.id ?? null
})

const screenOptions = computed(() => screens.value.map((s) => ({ value: s.id, label: s.name })))
/** The variants a Change to on the layer can show, when it sits in an interactive component. */
const variantOptions = computed(() => {
  void version.value
  return nodeId
    ? changeDestinations(store.graph, nodeId).map((s) => ({ value: s.id, label: s.name }))
    : []
})
const scrollOptions = computed(() =>
  SCROLL_DIRECTIONS.map((v) => ({ value: v, label: optionLabel(t.value, 'scroll', v) }))
)

/** The selected frame's scroll direction, or null when the selection cannot scroll. */
const scroll = computed<ScrollDirection | null>(() => {
  void version.value
  const node = nodeId ? store.graph.getNode(nodeId) : null
  if (!node || (node.type !== 'FRAME' && node.type !== 'COMPONENT' && node.type !== 'INSTANCE'))
    return null
  return readScroll(node)
})

function setScroll(direction: ScrollDirection) {
  if (nodeId) void run('set_scroll_behavior', { id: nodeId, direction })
}

function toolDef(name: string): ToolDef {
  const def = ALL_TOOLS.find((tool) => tool.name === name)
  if (!def) throw new Error(`Missing tool ${name}`)
  return def
}

async function run(name: string, args: Record<string, unknown>) {
  if (busy.value) return null
  busy.value = true
  try {
    const result = await runEditorTool({
      store,
      figma: makeFigmaFromStore(store),
      def: toolDef(name),
      args,
      source: t.value.section
    })
    if (result && typeof result === 'object' && 'error' in result)
      throw new Error(String(result.error))
    return result
  } catch (error) {
    toast.error(t.value.failed({ error: error instanceof Error ? error.message : String(error) }))
    return null
  } finally {
    busy.value = false
  }
}

function save(list: Interaction[]) {
  if (nodeId) void run('set_interactions', { id: nodeId, interactions: list })
}

function nextScreen(): string | null {
  const here = startScreen.value
  const list = screens.value
  const index = list.findIndex((s) => s.id === here)
  return (list[index + 1] ?? list.find((s) => s.id !== here))?.id ?? null
}

function add() {
  const destination = nextScreen()
  const action: Action = destination
    ? { type: 'navigate', destination, transition: DEFAULT_TRANSITION }
    : { type: 'back', transition: DEFAULT_TRANSITION }
  save([...interactions.value, { trigger: { type: 'click' }, action }])
}

function update(index: number, interaction: Interaction) {
  save(interactions.value.map((item, i) => (i === index ? interaction : item)))
}

function remove(index: number) {
  save(interactions.value.filter((_, i) => i !== index))
}

async function autoLink() {
  const result = await run('auto_prototype', {})
  if (result && typeof result === 'object' && 'linked' in result)
    toast.info(t.value.autoDone({ count: Number(result.linked) }))
}

function present() {
  if (startScreen.value) openPlayer(pageId.value, startScreen.value)
  else toast.info(t.value.noScreens)
}
</script>

<template>
  <PanelSection :label="t.section" data-test-id="prototype-section">
    <div class="flex flex-col gap-1.5">
      <div class="flex gap-1.5">
        <Tip :label="t.presentHint">
          <AppButton
            color="primary"
            variant="solid"
            class="flex-1"
            data-test-id="prototype-present"
            :disabled="busy"
            @click="present"
          >
            <icon-lucide-play class="size-3.5" aria-hidden="true" />
            <span class="truncate">{{ t.present }}</span>
          </AppButton>
        </Tip>
      </div>
      <Tip :label="t.autoHint">
        <AppButton
          variant="outline"
          class="w-full justify-start"
          data-test-id="prototype-auto"
          :disabled="busy"
          @click="autoLink"
        >
          <icon-lucide-workflow class="size-3.5" aria-hidden="true" />
          <span class="truncate">{{ t.auto }}</span>
        </AppButton>
      </Tip>
      <AppButton
        variant="outline"
        class="w-full justify-start"
        data-test-id="prototype-show-connections"
        :aria-pressed="showPrototypeConnections"
        :data-active="showPrototypeConnections || undefined"
        @click="showPrototypeConnections = !showPrototypeConnections"
      >
        <icon-lucide-spline class="size-3.5" aria-hidden="true" />
        <span class="truncate">{{ t.showConnections }}</span>
        <icon-lucide-check v-if="showPrototypeConnections" class="ms-auto size-3.5" />
      </AppButton>
      <AppSelect
        v-if="scroll"
        :model-value="scroll"
        :options="scrollOptions"
        :label="t.scroll"
        data-test-id="prototype-scroll"
        @update:model-value="setScroll($event as ScrollDirection)"
      />

      <template v-if="nodeId">
        <div class="mt-2 flex items-center justify-between text-[11px] font-semibold text-surface">
          <span>{{ t.interactions }}</span>
          <IconButton :label="t.add" data-test-id="prototype-add" @click="add">
            <icon-lucide-plus class="size-3.5" />
          </IconButton>
        </div>
        <p v-if="interactions.length === 0" class="text-[11px] text-muted">{{ t.none }}</p>
        <PrototypeSectionInteraction
          v-for="(item, index) in interactions"
          :key="index"
          :interaction="item"
          :node-id="nodeId"
          :screen-options="screenOptions"
          :variant-options="variantOptions"
          :next-destination="nextScreen() ?? ''"
          @change="update(index, $event)"
          @remove="remove(index)"
        />
      </template>
    </div>
  </PanelSection>
</template>
