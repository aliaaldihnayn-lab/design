<script setup lang="ts">
import { formatHex, parse } from 'culori'
import { SliderRange, SliderRoot, SliderThumb, SliderTrack } from 'reka-ui'
import { computed, ref } from 'vue'

import type { PixelToolSettings, Tool } from '@lawha/core'
import { usePhotoMessages } from '@lawha/vue/i18n'

import { useEditorStore } from '@/app/editor/active-store'
import AppButton from '@/components/ui/button/AppButton.vue'
import AppCheckbox from '@/components/ui/toggle/AppCheckbox.vue'

const store = useEditorStore()
const t = usePhotoMessages()

const tool = computed<Tool>(() => store.state.activeTool)
const settings = computed(() => store.state.pixelTools)

const BRUSHES: ReadonlySet<Tool> = new Set<Tool>(['BRUSH', 'ERASER'])
const FILLS: ReadonlySet<Tool> = new Set<Tool>(['FILL_BUCKET', 'MAGIC_WAND'])
const SELECTIONS: ReadonlySet<Tool> = new Set<Tool>([
  'MARQUEE_RECT',
  'MARQUEE_ELLIPSE',
  'MAGIC_WAND'
])
const COLORED: ReadonlySet<Tool> = new Set<Tool>(['BRUSH', 'FILL_BUCKET', 'COLOR_PICKER'])

const shown = computed(
  () =>
    BRUSHES.has(tool.value) ||
    FILLS.has(tool.value) ||
    COLORED.has(tool.value) ||
    SELECTIONS.has(tool.value)
)
/** Whether pixels are selected, which the selection's outline on the canvas shows. */
const hasSelection = computed(() => !!store.state.pixelOverlay?.outline)
/** Whether a mask made from the selection hides the selection rather than the rest. */
const invertMask = ref(false)

type SliderKey = 'size' | 'hardness' | 'opacity' | 'tolerance' | 'feather'

interface Slider {
  key: SliderKey
  label: string
  min: number
  max: number
  /** What the slider shows for a stored value, and back. */
  toView: (value: number) => number
  fromView: (value: number) => number
}

const percent = { toView: (v: number) => Math.round(v * 100), fromView: (v: number) => v / 100 }

const sliders = computed<Slider[]>(() => {
  const list: Slider[] = []
  if (BRUSHES.has(tool.value)) {
    list.push(
      {
        key: 'size',
        label: t.value.brushSize,
        min: 1,
        max: 500,
        toView: Math.round,
        fromView: (v) => v
      },
      { key: 'hardness', label: t.value.brushHardness, min: 0, max: 100, ...percent },
      { key: 'opacity', label: t.value.brushOpacity, min: 1, max: 100, ...percent }
    )
  }
  if (FILLS.has(tool.value)) {
    list.push({ key: 'tolerance', label: t.value.tolerance, min: 0, max: 100, ...percent })
  }
  if (tool.value === 'FILL_BUCKET') {
    list.push({ key: 'opacity', label: t.value.brushOpacity, min: 1, max: 100, ...percent })
  }
  if (SELECTIONS.has(tool.value)) {
    list.push({
      key: 'feather',
      label: t.value.feather,
      min: 0,
      max: 200,
      toView: Math.round,
      fromView: (v) => v
    })
  }
  return list
})

const hex = computed(() => {
  const { r, g, b } = settings.value.color
  return formatHex({ mode: 'rgb', r, g, b })
})

function setColor(event: Event) {
  const input = event.target
  if (!(input instanceof HTMLInputElement)) return
  const color = parse(input.value)
  if (!color || color.mode !== 'rgb') return
  store.setPixelTools({ color: { r: color.r, g: color.g, b: color.b, a: 1 } })
}

function setSlider(slider: Slider, value: number[] | undefined) {
  const v = value?.[0]
  if (v === undefined) return
  const change: Partial<PixelToolSettings> = { [slider.key]: slider.fromView(v) }
  store.setPixelTools(change)
}

function setContiguous(value: boolean) {
  store.setPixelTools({ contiguous: value })
}

function setInvertMask(value: boolean) {
  invertMask.value = value
}

function maskFromSelection() {
  store.pixelMaskFromSelection({ invert: invertMask.value })
}
</script>

<template>
  <div
    v-if="shown"
    data-canvas-obstacle
    data-test-id="pixel-tool-options"
    class="absolute bottom-18 left-1/2 z-10 flex -translate-x-1/2 items-center gap-3 rounded-lg bg-panel px-3 py-1.5 text-[11px] shadow-[0_8px_30px_rgb(0_0_0/0.4)]"
  >
    <label v-if="COLORED.has(tool)" class="flex items-center gap-1.5 text-muted">
      {{ t.brushColor }}
      <input
        type="color"
        class="size-5 cursor-pointer rounded border border-border bg-transparent"
        data-test-id="pixel-tool-color"
        :value="hex"
        @input="setColor"
      />
    </label>
    <div v-for="slider in sliders" :key="slider.key" class="flex items-center gap-1.5">
      <span class="text-muted">{{ slider.label }}</span>
      <SliderRoot
        :model-value="[slider.toView(settings[slider.key])]"
        :min="slider.min"
        :max="slider.max"
        :step="1"
        class="relative flex h-4 w-20 touch-none items-center select-none"
        :data-pixel-setting="slider.key"
        @update:model-value="setSlider(slider, $event)"
      >
        <SliderTrack class="relative h-1 grow rounded-full bg-hover">
          <SliderRange class="absolute h-full rounded-full bg-accent/60" />
        </SliderTrack>
        <SliderThumb
          :aria-label="slider.label"
          class="block size-3 rounded-full border border-border bg-panel shadow outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
      </SliderRoot>
      <span class="w-7 text-end tabular-nums text-muted" dir="ltr">
        {{ slider.toView(settings[slider.key]) }}
      </span>
    </div>
    <label v-if="FILLS.has(tool)" class="flex items-center gap-1.5 text-muted">
      <AppCheckbox
        :model-value="settings.contiguous"
        :ariaLabel="t.contiguous"
        @update:model-value="setContiguous"
      />
      {{ t.contiguous }}
    </label>
    <template v-if="SELECTIONS.has(tool)">
      <AppButton size="xs" data-test-id="pixel-select-all" @click="store.pixelSelectAll()">
        {{ t.selectAll }}
      </AppButton>
      <AppButton
        size="xs"
        :disabled="!hasSelection"
        data-test-id="pixel-deselect"
        @click="store.pixelDeselect()"
      >
        {{ t.deselect }}
      </AppButton>
      <AppButton
        size="xs"
        :disabled="!hasSelection"
        data-test-id="pixel-invert-selection"
        @click="store.pixelInvertSelection()"
      >
        {{ t.invertSelection }}
      </AppButton>
      <label class="flex items-center gap-1.5 text-muted">
        <AppCheckbox
          :model-value="invertMask"
          :ariaLabel="t.invertMask"
          @update:model-value="setInvertMask"
        />
        {{ t.invertMask }}
      </label>
      <AppButton
        size="xs"
        variant="soft"
        :disabled="!hasSelection"
        data-test-id="pixel-mask-from-selection"
        @click="maskFromSelection"
      >
        {{ t.maskFromSelection }}
      </AppButton>
    </template>
  </div>
</template>
