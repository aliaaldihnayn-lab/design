<script setup lang="ts">
import { computed, ref } from 'vue'

import {
  WARP_PRESETS,
  WIDTH_PROFILES,
  type WarpPreset,
  type WidthProfile
} from '@lawha/core/vector'
import { usePathMessages } from '@lawha/vue/i18n'

import { useEditorStore } from '@/app/editor/active-store'
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

type Join = 'MITER' | 'ROUND' | 'BEVEL'

const store = useEditorStore()
const distance = ref(10)
const join = ref<Join>('MITER')
const profile = ref<WidthProfile>('taper-both')
const blendSteps = ref(5)

const joinOptions = computed(() => [
  { value: 'MITER' as const, label: paths.value.joinMiter },
  { value: 'ROUND' as const, label: paths.value.joinRound },
  { value: 'BEVEL' as const, label: paths.value.joinBevel }
])

const profileOptions = computed(() => {
  const labels: Record<WidthProfile, string> = {
    uniform: paths.value.profileUniform,
    'taper-start': paths.value.profileTaperStart,
    'taper-end': paths.value.profileTaperEnd,
    'taper-both': paths.value.profileTaperBoth,
    bulge: paths.value.profileBulge,
    pinch: paths.value.profilePinch
  }
  return WIDTH_PROFILES.map((id) => ({ value: id, label: labels[id] }))
})

/** The two selected layers, lower first, when they are siblings: what blends and patterns take. */
const pair = computed(() => {
  if (nodeIds.length !== 2) return null
  const [a, b] = nodeIds.map((id) => store.graph.getNode(id))
  if (!a || !b || a.parentId !== b.parentId || !a.parentId) return null
  const siblings = store.graph.getNode(a.parentId)?.childIds ?? []
  return siblings.indexOf(a.id) < siblings.indexOf(b.id)
    ? { lower: a, upper: b }
    : { lower: b, upper: a }
})

function applyOffset() {
  void run('offset_path', { ids: nodeIds, distance: distance.value, join: join.value })
}

function applyWidth() {
  void run('width_profile', { ids: nodeIds, profile: profile.value })
}

function makeBlend() {
  if (!pair.value) return
  void run('blend_shapes', {
    from_id: pair.value.lower.id,
    to_id: pair.value.upper.id,
    steps: blendSteps.value
  })
}

function makePattern() {
  if (!pair.value) return
  void run('set_pattern_fill', { ids: [pair.value.lower.id], source_id: pair.value.upper.id })
}

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

      <PanelGrid :columns="2" class="mt-2">
        <PanelFieldGroup :label="paths.offset">
          <NumberField
            v-model="distance"
            suffix="px"
            :min="-1000"
            :max="1000"
            :aria-label="paths.offset"
            data-test-id="offset-distance"
          />
        </PanelFieldGroup>
        <PanelFieldGroup :label="paths.join">
          <AppSelect v-model="join" :options="joinOptions" :label="paths.join" />
        </PanelFieldGroup>
      </PanelGrid>
      <AppButton
        variant="outline"
        class="w-full justify-start"
        data-test-id="apply-offset"
        :title="paths.applyOffsetHint"
        :disabled="busy"
        @click="applyOffset"
      >
        <icon-lucide-square-dashed class="size-3.5" aria-hidden="true" />
        <span class="truncate">{{ paths.applyOffset }}</span>
      </AppButton>

      <PanelFieldGroup :label="paths.widthProfile" class="mt-2">
        <AppSelect
          v-model="profile"
          :options="profileOptions"
          :label="paths.widthProfile"
          data-test-id="width-profile"
        />
      </PanelFieldGroup>
      <AppButton
        variant="outline"
        class="w-full justify-start"
        data-test-id="apply-width"
        :title="paths.applyWidthHint"
        :disabled="busy"
        @click="applyWidth"
      >
        <icon-lucide-pen-line class="size-3.5" aria-hidden="true" />
        <span class="truncate">{{ paths.applyWidth }}</span>
      </AppButton>

      <template v-if="pair">
        <PanelFieldGroup :label="paths.blendSteps" class="mt-2">
          <NumberField
            v-model="blendSteps"
            :min="1"
            :max="256"
            :step="1"
            :aria-label="paths.blendSteps"
            data-test-id="blend-steps"
          />
        </PanelFieldGroup>
        <AppButton
          variant="outline"
          class="w-full justify-start"
          data-test-id="make-blend"
          :title="paths.makeBlendHint"
          :disabled="busy"
          @click="makeBlend"
        >
          <icon-lucide-git-merge class="size-3.5" aria-hidden="true" />
          <span class="truncate">{{ paths.makeBlend }}</span>
        </AppButton>
        <AppButton
          variant="outline"
          class="w-full justify-start"
          data-test-id="make-pattern"
          :title="paths.makePatternHint"
          :disabled="busy"
          @click="makePattern"
        >
          <icon-lucide-grid-3x3 class="size-3.5" aria-hidden="true" />
          <span class="truncate">{{ paths.makePattern }}</span>
        </AppButton>
      </template>
    </div>
  </PanelSection>
</template>
