<script setup lang="ts">
import { computed, ref } from 'vue'

import { WARP_PRESETS, type WarpPreset } from '@lawha/core/vector'
import { usePathMessages } from '@lawha/vue/i18n'

import NumberField from '@/components/inputs/NumberField.vue'
import AppButton from '@/components/ui/button/AppButton.vue'
import PanelFieldGroup from '@/components/ui/panel/PanelFieldGroup.vue'
import PanelGrid from '@/components/ui/panel/PanelGrid.vue'
import PanelSection from '@/components/ui/panel/PanelSection.vue'
import AppSelect from '@/components/ui/select/AppSelect.vue'

import { usePathToolRun } from './run'

/** The selected layers the section works on. */
const { nodeIds } = defineProps<{ nodeIds: string[] }>()

const paths = usePathMessages()
const { busy, run } = usePathToolRun()

const preset = ref<WarpPreset>('arc')
const bend = ref(50)
const horizontal = ref(0)
const vertical = ref(0)

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

function applyWarp() {
  void run('warp_shape', {
    ids: nodeIds,
    preset: preset.value,
    bend: bend.value / 100,
    horizontal: horizontal.value / 100,
    vertical: vertical.value / 100
  })
}
</script>

<template>
  <PanelSection :label="paths.section" data-test-id="path-effects-section">
    <div class="flex flex-col gap-1.5">
      <PanelFieldGroup :label="paths.warpStyle">
        <AppSelect
          v-model="preset"
          :options="presetOptions"
          :label="paths.warpStyle"
          data-test-id="warp-preset"
        />
      </PanelFieldGroup>
      <PanelGrid :columns="3">
        <PanelFieldGroup :label="paths.bend">
          <NumberField
            v-model="bend"
            suffix="%"
            :min="-100"
            :max="100"
            :aria-label="paths.bend"
            data-test-id="warp-bend"
          />
        </PanelFieldGroup>
        <PanelFieldGroup :label="paths.horizontalDistortion">
          <NumberField
            v-model="horizontal"
            suffix="%"
            :min="-100"
            :max="100"
            :aria-label="paths.horizontalDistortion"
          />
        </PanelFieldGroup>
        <PanelFieldGroup :label="paths.verticalDistortion">
          <NumberField
            v-model="vertical"
            suffix="%"
            :min="-100"
            :max="100"
            :aria-label="paths.verticalDistortion"
          />
        </PanelFieldGroup>
      </PanelGrid>
      <AppButton
        variant="outline"
        class="w-full justify-start"
        data-test-id="apply-warp"
        :title="paths.applyWarpHint"
        :disabled="busy"
        @click="applyWarp"
      >
        <icon-lucide-waves class="size-3.5" aria-hidden="true" />
        <span class="truncate">{{ paths.applyWarp }}</span>
      </AppButton>
    </div>
  </PanelSection>
</template>
