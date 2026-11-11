<script setup lang="ts">
import { computed } from 'vue'

import { WARP_PRESETS, type PathEffect, type WarpPreset } from '@lawha/scene-graph/path-effects'
import { usePathMessages } from '@lawha/vue/i18n'

import { useEditorStore } from '@/app/editor/active-store'
import NumberField from '@/components/inputs/NumberField.vue'
import AppButton from '@/components/ui/button/AppButton.vue'
import Tip from '@/components/ui/overlay/Tip.vue'
import PanelFieldGroup from '@/components/ui/panel/PanelFieldGroup.vue'
import PanelGrid from '@/components/ui/panel/PanelGrid.vue'
import AppSelect from '@/components/ui/select/AppSelect.vue'

import { usePathToolRun } from './run'

/** The layer with a live effect, and the effect as it is now. */
const { nodeId, effect } = defineProps<{ nodeId: string; effect: PathEffect }>()

const paths = usePathMessages()
const store = useEditorStore()
const { busy, run } = usePathToolRun()

const presetOptions = computed(() => {
  const labels: Record<WarpPreset, string> = {
    arc: paths.value.presetArc,
    arch: paths.value.presetArch,
    bulge: paths.value.presetBulge,
    flag: paths.value.presetFlag,
    wave: paths.value.presetWave,
    fish: paths.value.presetFish,
    rise: paths.value.presetRise,
    squeeze: paths.value.presetSqueeze,
    twist: paths.value.presetTwist
  }
  return WARP_PRESETS.map((id) => ({ value: id, label: labels[id] }))
})

const kindLabel = computed(() => {
  if (effect.kind === 'warp') return paths.value.liveWarp
  if (effect.kind === 'mesh') return paths.value.liveMesh
  return paths.value.liveWidth
})

function edit(patch: Record<string, unknown>) {
  void run('edit_path_effect', { id: nodeId, ...patch }, { quiet: true })
}

/** Percent fields for −1…1 amounts. */
function percent(value: number) {
  return Math.round(value * 100)
}

function expand() {
  void run('expand_path_effect', { ids: [nodeId] })
}

function release() {
  void run('release_path_effect', { ids: [nodeId] })
}

function openWidthTool() {
  store.setTool('WIDTH')
}
</script>

<template>
  <div class="flex flex-col gap-1.5" data-test-id="live-effect-fields">
    <p class="text-xs text-muted">{{ kindLabel }}</p>
    <template v-if="effect.kind === 'warp'">
      <PanelFieldGroup :label="paths.warpStyle">
        <AppSelect
          :model-value="effect.preset"
          :options="presetOptions"
          :label="paths.warpStyle"
          data-test-id="live-warp-preset"
          @update:model-value="edit({ preset: $event })"
        />
      </PanelFieldGroup>
      <PanelGrid :columns="3">
        <PanelFieldGroup :label="paths.bend">
          <NumberField
            :model-value="percent(effect.bend)"
            suffix="%"
            :min="-100"
            :max="100"
            :aria-label="paths.bend"
            data-test-id="live-warp-bend"
            @update:model-value="edit({ bend: $event / 100 })"
          />
        </PanelFieldGroup>
        <PanelFieldGroup :label="paths.horizontalDistortion">
          <NumberField
            :model-value="percent(effect.horizontal)"
            suffix="%"
            :min="-100"
            :max="100"
            :aria-label="paths.horizontalDistortion"
            @update:model-value="edit({ horizontal: $event / 100 })"
          />
        </PanelFieldGroup>
        <PanelFieldGroup :label="paths.verticalDistortion">
          <NumberField
            :model-value="percent(effect.vertical)"
            suffix="%"
            :min="-100"
            :max="100"
            :aria-label="paths.verticalDistortion"
            @update:model-value="edit({ vertical: $event / 100 })"
          />
        </PanelFieldGroup>
      </PanelGrid>
    </template>
    <template v-else-if="effect.kind === 'mesh'">
      <PanelGrid :columns="2">
        <PanelFieldGroup :label="paths.meshRows">
          <NumberField
            :model-value="effect.rows"
            :min="1"
            :max="16"
            :step="1"
            :aria-label="paths.meshRows"
            data-test-id="live-mesh-rows"
            @update:model-value="edit({ rows: $event })"
          />
        </PanelFieldGroup>
        <PanelFieldGroup :label="paths.meshColumns">
          <NumberField
            :model-value="effect.columns"
            :min="1"
            :max="16"
            :step="1"
            :aria-label="paths.meshColumns"
            data-test-id="live-mesh-columns"
            @update:model-value="edit({ columns: $event })"
          />
        </PanelFieldGroup>
      </PanelGrid>
      <p class="text-xs text-muted">{{ paths.meshHint }}</p>
    </template>
    <template v-else>
      <p class="text-xs text-muted">{{ paths.widthHint({ count: effect.points.length }) }}</p>
      <AppButton variant="outline" class="w-full justify-start" @click="openWidthTool">
        <icon-lucide-spline class="size-3.5" aria-hidden="true" />
        <span class="truncate">{{ paths.openWidthTool }}</span>
      </AppButton>
    </template>
    <PanelGrid :columns="2">
      <Tip :label="paths.expandHint">
        <AppButton
          variant="outline"
          data-test-id="expand-live-effect"
          :disabled="busy"
          @click="expand"
        >
          <span class="truncate">{{ paths.expand }}</span>
        </AppButton>
      </Tip>
      <Tip :label="paths.releaseHint">
        <AppButton
          variant="outline"
          data-test-id="release-live-effect"
          :disabled="busy"
          @click="release"
        >
          <span class="truncate">{{ paths.release }}</span>
        </AppButton>
      </Tip>
    </PanelGrid>
  </div>
</template>
