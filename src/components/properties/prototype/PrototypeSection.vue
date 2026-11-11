<script setup lang="ts">
import { computed } from 'vue'

import {
  SCROLL_DIRECTIONS,
  readInteractions,
  readScroll,
  type Action,
  type Interaction,
  type ScrollDirection
} from '@lawha/core/prototype'
import { usePrototypeMessages } from '@lawha/vue/i18n'

import { useEditorStore } from '@/app/editor/active-store'
import { showPrototypeConnections } from '@/app/prototype/connections'
import { openPlayer } from '@/app/prototype/player'
import { toast } from '@/app/shell/ui'
import AppButton from '@/components/ui/button/AppButton.vue'
import IconButton from '@/components/ui/button/IconButton.vue'
import PanelSection from '@/components/ui/panel/PanelSection.vue'
import AppSelect from '@/components/ui/select/AppSelect.vue'

import PrototypeSectionBindings from './PrototypeSectionBindings.vue'
import PrototypeSectionInteraction from './PrototypeSectionInteraction.vue'
import { DEFAULT_TRANSITION, usePrototypeOptions } from './usePrototypeOptions'
import { usePrototypeTools } from './usePrototypeTools'

const { nodeId = null } = defineProps<{ nodeId?: string | null }>()

const store = useEditorStore()
const t = usePrototypeMessages()
const { busy, run } = usePrototypeTools()
const options = usePrototypeOptions(() => nodeId)

const interactions = computed<Interaction[]>(() => {
  void store.state.sceneVersion
  const node = nodeId ? store.graph.getNode(nodeId) : null
  return node ? readInteractions(node, store.graph) : []
})

const scrollOptions = computed(() =>
  SCROLL_DIRECTIONS.map((v) => ({ value: v, label: options.label('scroll', v) }))
)

/** The selected frame's scroll direction, or null when the selection cannot scroll. */
const scroll = computed<ScrollDirection | null>(() => {
  void store.state.sceneVersion
  const node = nodeId ? store.graph.getNode(nodeId) : null
  if (!node || (node.type !== 'FRAME' && node.type !== 'COMPONENT' && node.type !== 'INSTANCE'))
    return null
  return readScroll(node)
})

function setScroll(direction: ScrollDirection) {
  if (nodeId) void run('set_scroll_behavior', { id: nodeId, direction })
}

function save(list: Interaction[]) {
  if (nodeId) void run('set_interactions', { id: nodeId, interactions: list })
}

function add() {
  const destination = options.nextScreen()
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
  const start = options.startScreen.value
  if (start) openPlayer(options.pageId.value, start)
  else toast.info(t.value.noScreens)
}
</script>

<template>
  <PanelSection :label="t.section" data-test-id="prototype-section">
    <div class="flex flex-col gap-1.5">
      <div class="flex gap-1.5">
        <AppButton
          color="primary"
          variant="solid"
          class="flex-1"
          data-test-id="prototype-present"
          :title="t.presentHint"
          :disabled="busy"
          @click="present"
        >
          <icon-lucide-play class="size-3.5" aria-hidden="true" />
          <span class="truncate">{{ t.present }}</span>
        </AppButton>
      </div>
      <AppButton
        variant="outline"
        class="w-full justify-start"
        data-test-id="prototype-auto"
        :title="t.autoHint"
        :disabled="busy"
        @click="autoLink"
      >
        <icon-lucide-workflow class="size-3.5" aria-hidden="true" />
        <span class="truncate">{{ t.auto }}</span>
      </AppButton>
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
          @change="update(index, $event)"
          @remove="remove(index)"
        />
        <PrototypeSectionBindings :node-id="nodeId" />
      </template>
    </div>
  </PanelSection>
</template>
