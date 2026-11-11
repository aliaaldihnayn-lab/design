<script setup lang="ts">
import { computed } from 'vue'

import type { LiveBlend } from '@lawha/scene-graph/path-effects'
import { usePathMessages } from '@lawha/vue/i18n'

import NumberField from '@/components/inputs/NumberField.vue'
import AppButton from '@/components/ui/button/AppButton.vue'
import PanelFieldGroup from '@/components/ui/panel/PanelFieldGroup.vue'
import PanelGrid from '@/components/ui/panel/PanelGrid.vue'
import AppSelect from '@/components/ui/select/AppSelect.vue'

import { usePathToolRun } from './run'

/**
 * A live blend's options: the group that holds it, the blend as it is now, and another selected
 * path that can become its spine.
 */
const { groupId, blend, spineCandidateId } = defineProps<{
  groupId: string
  blend: LiveBlend
  spineCandidateId: string | null
}>()

const paths = usePathMessages()
const { busy, run } = usePathToolRun()

const spacingOptions = computed(() => [
  { value: 'steps' as const, label: paths.value.spacingSteps },
  { value: 'distance' as const, label: paths.value.spacingDistance }
])

function edit(patch: Record<string, unknown>) {
  void run('edit_blend', { id: groupId, ...patch }, { quiet: true })
}

function replaceSpine() {
  if (spineCandidateId) void run('edit_blend', { id: groupId, spine_id: spineCandidateId })
}
</script>

<template>
  <div class="flex flex-col gap-1.5" data-test-id="live-blend-fields">
    <p class="text-xs text-muted">{{ paths.liveBlend }}</p>
    <PanelGrid :columns="2">
      <PanelFieldGroup :label="paths.blendSpacing">
        <AppSelect
          :model-value="blend.spacing"
          :options="spacingOptions"
          :label="paths.blendSpacing"
          data-test-id="live-blend-spacing"
          @update:model-value="edit({ spacing: $event })"
        />
      </PanelFieldGroup>
      <PanelFieldGroup v-if="blend.spacing === 'steps'" :label="paths.blendSteps">
        <NumberField
          :model-value="blend.steps"
          :min="1"
          :max="256"
          :step="1"
          :aria-label="paths.blendSteps"
          data-test-id="live-blend-steps"
          @update:model-value="edit({ steps: $event })"
        />
      </PanelFieldGroup>
      <PanelFieldGroup v-else :label="paths.blendDistance">
        <NumberField
          :model-value="blend.distance"
          suffix="px"
          :min="1"
          :max="10000"
          :aria-label="paths.blendDistance"
          data-test-id="live-blend-distance"
          @update:model-value="edit({ distance: $event })"
        />
      </PanelFieldGroup>
    </PanelGrid>
    <AppButton
      variant="outline"
      class="w-full justify-start"
      data-test-id="refresh-blend"
      :title="paths.refreshBlendHint"
      :disabled="busy"
      @click="edit({})"
    >
      <icon-lucide-refresh-cw class="size-3.5" aria-hidden="true" />
      <span class="truncate">{{ paths.refreshBlend }}</span>
    </AppButton>
    <AppButton
      v-if="spineCandidateId"
      variant="outline"
      class="w-full justify-start"
      data-test-id="replace-spine"
      :title="paths.replaceSpineHint"
      :disabled="busy"
      @click="replaceSpine"
    >
      <icon-lucide-spline class="size-3.5" aria-hidden="true" />
      <span class="truncate">{{ paths.replaceSpine }}</span>
    </AppButton>
    <PanelGrid :columns="2">
      <AppButton
        variant="outline"
        data-test-id="expand-blend"
        :title="paths.expandBlendHint"
        :disabled="busy"
        @click="run('expand_blend', { id: groupId })"
      >
        <span class="truncate">{{ paths.expand }}</span>
      </AppButton>
      <AppButton
        variant="outline"
        data-test-id="release-blend"
        :title="paths.releaseBlendHint"
        :disabled="busy"
        @click="run('release_blend', { id: groupId })"
      >
        <span class="truncate">{{ paths.release }}</span>
      </AppButton>
    </PanelGrid>
  </div>
</template>
