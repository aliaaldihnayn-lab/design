<script setup lang="ts">
import { computed } from 'vue'

import type { Hotspot, PinnedLayer, TriggerType } from '@lawha/core/prototype'
import type { Rect } from '@lawha/scene-graph/primitives'

import type { RegionImages } from '@/app/prototype/frames'

defineOptions({ name: 'PrototypeScrollRegion' })

const { entry, regions, scale, flash, spotsIn, spotsOnPinned } = defineProps<{
  entry: RegionImages
  /** Every scrolling frame on the screen, so nested ones draw inside this one's content. */
  regions: RegionImages[]
  scale: number
  flash: boolean
  /** Hotspots that scroll with this frame's content, placed in it. */
  spotsIn: (region: string) => Hotspot[]
  /** Hotspots on one of its pinned layers, placed in that layer. */
  spotsOnPinned: (region: string, layer: string) => Hotspot[]
}>()

const emit = defineEmits<{ hotspot: [spot: Hotspot, type: TriggerType]; miss: [] }>()

const region = computed(() => entry.region)
const children = computed(() =>
  regions.filter((other) => other.region.parent === region.value.node)
)
const fixed = computed(() => region.value.pinned.filter((layer) => layer.mode === 'fixed'))
const sticky = computed(() => region.value.pinned.filter((layer) => layer.mode === 'sticky'))

const px = (value: number) => `${value * scale}px`
const box = (rect: Rect) => ({
  left: px(rect.x),
  top: px(rect.y),
  width: px(rect.width),
  height: px(rect.height)
})

/**
 * A sticky layer sits in a box from its place to the content's far edge, and sticks to the
 * top (and start, when it scrolls sideways) of the frame once scrolled there.
 */
function stickyTrack(layer: PinnedLayer) {
  const vertical = region.value.direction !== 'horizontal'
  const horizontal = region.value.direction !== 'vertical'
  return {
    left: px(layer.x),
    top: px(layer.y),
    width: px(horizontal ? region.value.contentWidth - layer.x : layer.width),
    height: px(vertical ? region.value.contentHeight - layer.y : layer.height)
  }
}

function stickyLayer(layer: PinnedLayer) {
  const vertical = region.value.direction !== 'horizontal'
  const horizontal = region.value.direction !== 'vertical'
  return {
    position: 'sticky' as const,
    top: vertical ? '0px' : undefined,
    left: horizontal ? '0px' : undefined,
    width: px(layer.width),
    height: px(layer.height)
  }
}

const hotspotClass = computed(() =>
  flash ? 'bg-[rgb(56_189_248/0.3)] ring-2 ring-[#38bdf8]' : 'bg-transparent'
)
</script>

<template>
  <div class="absolute" :style="box(region)" :data-scroll-region="region.node">
    <div
      class="size-full"
      :class="{
        'overflow-y-auto overflow-x-hidden': region.direction === 'vertical',
        'overflow-x-auto overflow-y-hidden': region.direction === 'horizontal',
        'overflow-auto': region.direction === 'both'
      }"
      :data-scroll="region.node"
      @click.self="emit('miss')"
    >
      <div
        class="relative"
        :style="{ width: px(region.contentWidth), height: px(region.contentHeight) }"
        @click.self="emit('miss')"
      >
        <img
          :src="entry.image"
          alt=""
          class="pointer-events-none size-full select-none"
          draggable="false"
        />
        <PrototypeScrollRegion
          v-for="child in children"
          :key="child.region.node"
          :entry="child"
          :regions="regions"
          :scale="scale"
          :flash="flash"
          :spots-in="spotsIn"
          :spots-on-pinned="spotsOnPinned"
          @hotspot="(spot, type) => emit('hotspot', spot, type)"
          @miss="emit('miss')"
        />
        <button
          v-for="spot in spotsIn(region.node)"
          :key="spot.node"
          type="button"
          class="absolute rounded-sm transition-colors"
          :class="hotspotClass"
          :data-hotspot="spot.node"
          :style="box(spot)"
          @click.stop="emit('hotspot', spot, 'click')"
          @mouseenter="emit('hotspot', spot, 'hover')"
          @pointerdown="emit('hotspot', spot, 'press')"
        />
        <div
          v-for="layer in sticky"
          :key="layer.node"
          class="pointer-events-none absolute"
          :style="stickyTrack(layer)"
        >
          <div
            class="pointer-events-auto relative"
            :style="stickyLayer(layer)"
            :data-pinned="layer.node"
          >
            <img
              :src="entry.pinned[layer.node]"
              alt=""
              class="pointer-events-none size-full select-none"
              draggable="false"
            />
            <button
              v-for="spot in spotsOnPinned(region.node, layer.node)"
              :key="spot.node"
              type="button"
              class="absolute rounded-sm transition-colors"
              :class="hotspotClass"
              :data-hotspot="spot.node"
              :style="box(spot)"
              @click.stop="emit('hotspot', spot, 'click')"
              @mouseenter="emit('hotspot', spot, 'hover')"
            />
          </div>
        </div>
      </div>
    </div>
    <div
      v-for="layer in fixed"
      :key="layer.node"
      class="absolute"
      :style="box(layer)"
      :data-pinned="layer.node"
    >
      <img
        :src="entry.pinned[layer.node]"
        alt=""
        class="pointer-events-none size-full select-none"
        draggable="false"
      />
      <button
        v-for="spot in spotsOnPinned(region.node, layer.node)"
        :key="spot.node"
        type="button"
        class="absolute rounded-sm transition-colors"
        :class="hotspotClass"
        :data-hotspot="spot.node"
        :style="box(spot)"
        @click.stop="emit('hotspot', spot, 'click')"
        @mouseenter="emit('hotspot', spot, 'hover')"
      />
    </div>
  </div>
</template>
