<script setup lang="ts">
import { computed } from 'vue'

import { useSelectionState } from '@lawha/vue/editor/selection-state'
import { useFramePresetMessages, useI18n } from '@lawha/vue/i18n'

import { useEditorStore } from '@/app/editor/active-store'
import {
  findFrameResizePreset,
  framePresetLabel,
  FRAME_RESIZE_PRESET_CATEGORIES,
  FRAME_RESIZE_PRESETS
} from '@/app/editor/frame-presets'
import PanelSection from '@/components/ui/panel/PanelSection.vue'
import AppSelect from '@/components/ui/select/AppSelect.vue'

const store = useEditorStore()
const { selectedNode } = useSelectionState()
const { panels } = useI18n()
const names = useFramePresetMessages()

const selectedPreset = computed(() => {
  const node = selectedNode.value
  if (!node) return undefined
  // A frame made from a preset carries its name as shown, translated or as Figma writes it.
  return (
    FRAME_RESIZE_PRESETS.find(
      (preset) =>
        preset.width === node.width &&
        preset.height === node.height &&
        framePresetLabel(preset, names.value) === node.name
    ) ?? findFrameResizePreset(node.width, node.height, node.name)
  )
})
const selectedPresetId = computed({
  get: () => selectedPreset.value?.id ?? 'custom',
  set: (id: string) => {
    const node = selectedNode.value
    const preset = FRAME_RESIZE_PRESETS.find((candidate) => candidate.id === id)
    if (node?.type === 'FRAME' && preset) store.resizeFrameToPreset(node.id, preset)
  }
})
const groups = computed(() =>
  FRAME_RESIZE_PRESET_CATEGORIES.map((category) => ({
    label: panels.value[category.labelKey],
    options: category.presets.map((preset) => ({
      value: preset.id,
      label: framePresetLabel(preset, names.value)
    }))
  }))
)
</script>

<template>
  <PanelSection :label="panels.frame">
    <AppSelect
      v-model="selectedPresetId"
      data-property="frame-preset"
      :label="panels.framePreset"
      :groups="groups"
      :placeholder="panels.framePresetCustom"
    />
  </PanelSection>
</template>
