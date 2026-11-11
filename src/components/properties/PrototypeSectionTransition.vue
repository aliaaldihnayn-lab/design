<script setup lang="ts">
import { computed } from 'vue'

import { DIRECTIONS, EASINGS, TRANSITION_TYPES, type Transition } from '@lawha/core/prototype'
import { usePrototypeMessages } from '@lawha/vue/i18n'

import AppSelect from '@/components/ui/select/AppSelect.vue'

import {
  DEFAULT_SPRING,
  SPRING_FIELDS,
  clampNumber,
  optionLabel,
  showsDirection,
  type SpringField
} from './prototype/interaction'

/** How an interaction's action animates: its type, direction, easing, duration, and spring. */
const { transition } = defineProps<{ transition: Transition }>()
const emit = defineEmits<{ change: [change: Partial<Transition>] }>()

const t = usePrototypeMessages()

const transitionOptions = computed(() =>
  TRANSITION_TYPES.map((v) => ({ value: v, label: optionLabel(t.value, 'transition', v) }))
)
const directionOptions = computed(() =>
  DIRECTIONS.map((v) => ({ value: v, label: optionLabel(t.value, 'direction', v) }))
)
const easingOptions = computed(() =>
  EASINGS.map((v) => ({ value: v, label: optionLabel(t.value, 'easing', v) }))
)

function setSpring(field: SpringField, value: string) {
  const number = Number(value)
  if (!Number.isFinite(number)) return
  const current = transition.spring ?? DEFAULT_SPRING
  emit('change', { spring: { ...DEFAULT_SPRING, ...current, [field]: number } })
}
</script>

<template>
  <AppSelect
    :model-value="transition.type ?? 'instant'"
    :options="transitionOptions"
    :label="t.transition"
    data-test-id="prototype-transition"
    @update:model-value="emit('change', { type: $event as Transition['type'] })"
  />
  <div class="flex gap-1">
    <AppSelect
      v-if="showsDirection(transition)"
      :model-value="transition.direction ?? 'left'"
      :options="directionOptions"
      :label="t.direction"
      :ui="{ trigger: 'w-auto min-w-0 flex-1' }"
      @update:model-value="emit('change', { direction: $event as Transition['direction'] })"
    />
    <AppSelect
      :model-value="transition.easing ?? 'ease-out'"
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
      @change="
        emit('change', {
          duration: clampNumber(($event.target as HTMLInputElement).value, 5000)
        })
      "
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
