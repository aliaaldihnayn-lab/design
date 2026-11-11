<script setup lang="ts">
import { computed } from 'vue'

import type { Fill, PatternTileType, SceneNode } from '@lawha/scene-graph'
import { usePathMessages } from '@lawha/vue/i18n'
import { useSceneComputed } from '@lawha/vue/internal/scene-computed'

import { useEditorStore } from '@/app/editor/active-store'
import NumberField from '@/components/inputs/NumberField.vue'
import PanelFieldGroup from '@/components/ui/panel/PanelFieldGroup.vue'
import PanelGrid from '@/components/ui/panel/PanelGrid.vue'
import AppSelect from '@/components/ui/select/AppSelect.vue'

const { fill } = defineProps<{ fill: Fill }>()
const emit = defineEmits<{ update: [fill: Fill] }>()

const store = useEditorStore()
const paths = usePathMessages()

/** Layers that cannot be their own tile: the selection, which the fill is on. */
const selected = computed(() => new Set(store.state.selectedIds))

/**
 * What a pattern can tile: every component in the document, then the current page's top-level
 * layers, leaving out the layers the fill is on, as Illustrator's swatches and Figma's pattern
 * source picker offer them.
 */
const sources = useSceneComputed(() => {
  const usable = (node: SceneNode) =>
    !selected.value.has(node.id) && node.width > 0 && node.height > 0 && node.visible
  const components = [...store.graph.getAllNodes()].filter(
    (node) => node.type === 'COMPONENT' && usable(node)
  )
  const page = store.graph.getNode(store.state.currentPageId)
  const layers = (page?.childIds ?? [])
    .flatMap((id) => store.graph.getNode(id) ?? [])
    .filter((node) => node.type !== 'COMPONENT' && usable(node))
  return [
    ...components.map((node) => ({
      value: node.id,
      label: paths.value.patternComponent({ name: node.name })
    })),
    ...layers.map((node) => ({ value: node.id, label: node.name }))
  ]
})

const tileOptions = computed(() => [
  { value: 'RECTANGULAR' as const, label: paths.value.tileGrid },
  { value: 'HORIZONTAL_HEXAGONAL' as const, label: paths.value.tileBrickRows },
  { value: 'VERTICAL_HEXAGONAL' as const, label: paths.value.tileBrickColumns }
])

const spacing = computed(() => fill.patternSpacing ?? { x: 0, y: 0 })
const offset = computed(() => fill.patternOffset ?? { x: 0, y: 0 })

function update(patch: Partial<Fill>) {
  emit('update', { ...fill, type: 'PATTERN', ...patch })
}
</script>

<template>
  <div class="flex flex-col gap-1.5" data-test-id="pattern-fill-picker">
    <PanelFieldGroup :label="paths.patternSource">
      <AppSelect
        :model-value="fill.sourceNodeId ?? ''"
        :options="sources"
        :label="paths.patternSource"
        :placeholder="paths.patternSourcePlaceholder"
        data-test-id="pattern-source"
        @update:model-value="update({ sourceNodeId: String($event) })"
      />
    </PanelFieldGroup>
    <p v-if="sources.length === 0" class="text-xs text-muted">{{ paths.patternNoSources }}</p>
    <PanelGrid :columns="2">
      <PanelFieldGroup :label="paths.patternScale">
        <NumberField
          :model-value="Math.round((fill.scale ?? 1) * 100)"
          suffix="%"
          :min="1"
          :max="10000"
          :aria-label="paths.patternScale"
          data-test-id="pattern-scale"
          @update:model-value="update({ scale: $event / 100 })"
        />
      </PanelFieldGroup>
      <PanelFieldGroup :label="paths.patternRotation">
        <NumberField
          :model-value="fill.patternRotation ?? 0"
          suffix="°"
          :min="-360"
          :max="360"
          :aria-label="paths.patternRotation"
          data-test-id="pattern-rotation"
          @update:model-value="update({ patternRotation: $event })"
        />
      </PanelFieldGroup>
      <PanelFieldGroup :label="paths.patternSpacingX">
        <NumberField
          :model-value="Math.round(spacing.x * 100)"
          suffix="%"
          :min="0"
          :max="1000"
          :aria-label="paths.patternSpacingX"
          @update:model-value="update({ patternSpacing: { ...spacing, x: $event / 100 } })"
        />
      </PanelFieldGroup>
      <PanelFieldGroup :label="paths.patternSpacingY">
        <NumberField
          :model-value="Math.round(spacing.y * 100)"
          suffix="%"
          :min="0"
          :max="1000"
          :aria-label="paths.patternSpacingY"
          @update:model-value="update({ patternSpacing: { ...spacing, y: $event / 100 } })"
        />
      </PanelFieldGroup>
      <PanelFieldGroup :label="paths.patternOffsetX">
        <NumberField
          :model-value="offset.x"
          suffix="px"
          :aria-label="paths.patternOffsetX"
          @update:model-value="update({ patternOffset: { ...offset, x: $event } })"
        />
      </PanelFieldGroup>
      <PanelFieldGroup :label="paths.patternOffsetY">
        <NumberField
          :model-value="offset.y"
          suffix="px"
          :aria-label="paths.patternOffsetY"
          @update:model-value="update({ patternOffset: { ...offset, y: $event } })"
        />
      </PanelFieldGroup>
    </PanelGrid>
    <PanelFieldGroup :label="paths.patternTiles">
      <AppSelect
        :model-value="fill.patternTileType ?? 'RECTANGULAR'"
        :options="tileOptions"
        :label="paths.patternTiles"
        @update:model-value="update({ patternTileType: $event as PatternTileType })"
      />
    </PanelFieldGroup>
  </div>
</template>
