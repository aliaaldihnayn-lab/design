<script setup lang="ts">
import { computed } from 'vue'

import type { ViewportTransform } from '@lawha/core/geometry'
import type { JiraIssueState } from '@lawha/scene-graph/stories'
import { useStoriesMessages } from '@lawha/vue/i18n'

import { useEditorStore } from '@/app/editor/active-store'
import { showStoryPins, useStories } from '@/app/stories/use'

import { stories as storiesTheme } from './ui'

/**
 * A pin at the top-right corner of each layer on the page that carries user stories: how many,
 * and the Jira status of its linked issues. Clicking one selects the layer and opens its story.
 */
const { drawn = null } = defineProps<{
  /** The pan and zoom of the canvas's last drawn frame, which pins follow as comments do. */
  drawn?: ViewportTransform | null
}>()

const store = useEditorStore()
const stories = useStories()
const t = useStoriesMessages()
const ui = storiesTheme()

const placement = computed<ViewportTransform>(() => drawn ?? store.state)

/** The least advanced Jira status of a layer's stories: a pin is done only when all are. */
function pinCategory(states: JiraIssueState[]): JiraIssueState['category'] | undefined {
  if (states.length === 0) return undefined
  for (const category of ['new', 'indeterminate', 'undefined', 'done'] as const) {
    if (states.some((state) => state.category === category)) return category
  }
  return undefined
}

const pins = computed(() => {
  if (!showStoryPins.value) return []
  // Layers move without their stories changing; re-place pins on every scene change.
  void store.state.sceneVersion
  const zoom = placement.value.zoom
  return stories.pins.value.flatMap(({ nodeId, stories: layerStories }) => {
    const node = store.graph.getNode(nodeId)
    if (!node || !node.visible) return []
    const box = store.graph.getAbsoluteBounds(nodeId)
    const states = layerStories.flatMap((story) => (story.jira ? [story.jira] : []))
    return [
      {
        nodeId,
        name: node.name,
        count: layerStories.length,
        firstStoryId: layerStories[0]?.id ?? null,
        category: pinCategory(states),
        status: states.length === 1 ? states[0].status : undefined,
        left: (box.x + box.width) * zoom,
        top: box.y * zoom
      }
    ]
  })
})
</script>

<template>
  <div :class="ui.layer()" data-canvas-overlay="stories">
    <div
      :class="ui.pins()"
      :style="{ transform: `translate(${placement.panX}px, ${placement.panY}px)` }"
    >
      <button
        v-for="pin in pins"
        :key="pin.nodeId"
        type="button"
        data-slot="story-pin"
        :data-node-id="pin.nodeId"
        :data-selected="store.state.selectedIds.has(pin.nodeId) || undefined"
        :class="ui.pin()"
        :style="{ left: `${pin.left}px`, top: `${pin.top}px` }"
        :aria-label="t.storiesOnLayer({ count: pin.count, layer: pin.name })"
        @pointerdown.stop
        @click.stop="stories.openStory(pin.nodeId, pin.firstStoryId)"
      >
        <icon-lucide-book-open :class="ui.pinIcon()" aria-hidden="true" />
        <span>{{ pin.count }}</span>
        <span v-if="pin.category" :class="ui.pinStatus()" :data-category="pin.category" />
        <span v-if="pin.status" class="max-w-20 truncate font-normal text-muted" dir="auto">{{
          pin.status
        }}</span>
      </button>
    </div>
  </div>
</template>
