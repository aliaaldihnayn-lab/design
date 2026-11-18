<script setup lang="ts">
import { computed, toRef } from 'vue'

import { TRACE_PRESETS, tracePresetIsBlackAndWhite, type TracePreset } from '@lawha/core/vector'
import { useMediaMessages } from '@lawha/vue/i18n'

import type { LocalTraceOptions } from '@/app/editor/vectorize'
import { useTracePreview } from '@/app/editor/vectorize/settings/trace'
import NumberField from '@/components/inputs/NumberField.vue'
import ProviderSettingsField from '@/components/settings/provider/ProviderSettingsField.vue'
import AppSelect from '@/components/ui/select/AppSelect.vue'

/** Image Trace's settings being edited, which the preview traces with. */
const options = defineModel<LocalTraceOptions>({ required: true })

const media = useMediaMessages()
const preview = useTracePreview(toRef(options))

const presetOptions = computed(() => {
  const labels: Record<TracePreset, string> = {
    logo: media.value.tracePresetLogo,
    'photo-high': media.value.tracePresetPhotoHigh,
    'photo-low': media.value.tracePresetPhotoLow,
    'line-art': media.value.tracePresetLineArt,
    sketch: media.value.tracePresetSketch
  }
  return TRACE_PRESETS.map((id) => ({ value: id, label: labels[id] }))
})

const blackAndWhite = computed(() => tracePresetIsBlackAndWhite(options.value.preset))

function set(patch: Partial<LocalTraceOptions>) {
  options.value = { ...options.value, ...patch }
}
</script>

<template>
  <div class="flex flex-col gap-5" data-test-id="trace-settings">
    <ProviderSettingsField v-slot="{ control }" :label="media.tracePreset">
      <AppSelect
        v-bind="control"
        :model-value="options.preset"
        :options="presetOptions"
        :label="media.tracePreset"
        data-test-id="trace-preset"
        @update:model-value="set({ preset: $event })"
      />
    </ProviderSettingsField>
    <ProviderSettingsField v-if="blackAndWhite" v-slot="{ control }" :label="media.traceThreshold">
      <NumberField
        v-bind="control"
        :model-value="options.threshold"
        :min="0"
        :max="255"
        :step="1"
        :aria-label="media.traceThreshold"
        data-test-id="trace-threshold"
        @update:model-value="set({ threshold: $event })"
      />
    </ProviderSettingsField>
    <ProviderSettingsField v-else v-slot="{ control }" :label="media.traceColors">
      <NumberField
        v-bind="control"
        :model-value="options.colors"
        :min="2"
        :max="32"
        :step="1"
        :aria-label="media.traceColors"
        data-test-id="trace-colors"
        @update:model-value="set({ colors: $event })"
      />
    </ProviderSettingsField>
    <figure class="flex flex-col gap-1.5">
      <div
        class="flex aspect-square w-40 items-center justify-center overflow-hidden rounded border border-border bg-white"
      >
        <img
          v-if="preview.url.value"
          :src="preview.url.value"
          :alt="media.tracePreview"
          class="size-full object-contain"
          data-test-id="trace-preview"
        />
      </div>
      <figcaption class="text-xs text-muted">
        <template v-if="preview.error.value">{{ preview.error.value }}</template>
        <template v-else>{{
          (preview.fromSelection.value ? media.tracePreviewSelection : media.tracePreviewSample)({
            count: preview.colors.value
          })
        }}</template>
      </figcaption>
    </figure>
  </div>
</template>
