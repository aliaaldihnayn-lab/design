<script setup lang="ts">
import type { Transition } from '@lawha/core/prototype'
import { usePrototypeMessages } from '@lawha/vue/i18n'

import AppSelect from '@/components/ui/select/AppSelect.vue'

import { usePrototypeOptions } from './usePrototypeOptions'

/** How an action animates: its transition, direction, easing, duration, and spring. */
const { transition } = defineProps<{ transition: Transition }>()
const emit = defineEmits<{ change: [change: Partial<Transition>] }>()

const t = usePrototypeMessages()
const { transitionOptions, directionOptions, easingOptions } = usePrototypeOptions(null)

const SPRING_FIELDS = ['stiffness', 'damping', 'mass'] as const
const DEFAULT_SPRING = { stiffness: 300, damping: 20, mass: 1 }
const DIRECTED = ['slide-in', 'slide-out', 'push', 'move-in', 'move-out']

function setDuration(value: string) {
  emit('change', { duration: Math.max(0, Math.min(5000, Number(value) || 0)) })
}

function setSpring(field: (typeof SPRING_FIELDS)[number], value: string) {
  const number = Number(value)
  if (!Number.isFinite(number)) return
  emit('change', { spring: { ...DEFAULT_SPRING, ...transition.spring, [field]: number } })
}
</script>

<template>
  <AppSelect
    :model-value="transition.type"
    :options="transitionOptions"
    :label="t.transition"
    data-test-id="prototype-transition"
    @update:model-value="emit('change', { type: $event as Transition['type'] })"
  />
  <div class="flex gap-1">
    <AppSelect
      v-if="DIRECTED.includes(transition.type)"
      :model-value="transition.direction"
      :options="directionOptions"
      :label="t.direction"
      :ui="{ trigger: 'w-auto min-w-0 flex-1' }"
      @update:model-value="emit('change', { direction: $event as Transition['direction'] })"
    />
    <AppSelect
      :model-value="transition.easing"
      :options="easingOptions"
      :label="t.easing"
      :ui="{ trigger: 'w-auto min-w-0 flex-1' }"
      @update:model-value="emit('change', { easing: $event as Transition['easing'] })"
    />
    <input
      type="number"
      min="0"
      max="5000"
      step="50"
      class="h-6 w-16 rounded bg-input px-1.5 text-[11px]"
      :aria-label="t.duration"
      :value="transition.duration"
      @change="setDuration(($event.target as HTMLInputElement).value)"
    />
  </div>
  <div v-if="transition.easing === 'custom-spring'" class="flex gap-1">
    <input
      v-for="field in SPRING_FIELDS"
      :key="field"
      type="number"
      step="any"
      class="h-6 w-0 flex-1 rounded bg-input px-1.5 text-[11px]"
      :aria-label="t[field]"
      :value="transition.spring?.[field] ?? DEFAULT_SPRING[field]"
      @change="setSpring(field, ($event.target as HTMLInputElement).value)"
    />
  </div>
</template>
