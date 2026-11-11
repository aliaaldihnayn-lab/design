<script setup lang="ts">
import type { Action, Transition } from '@lawha/core/prototype'
import { usePrototypeMessages } from '@lawha/vue/i18n'

import AppSelect from '@/components/ui/select/AppSelect.vue'

import PrototypeSectionTransition from './PrototypeSectionTransition.vue'
import PrototypeSectionVariableAction from './PrototypeSectionVariableAction.vue'
import { DEFAULT_TRANSITION, usePrototypeOptions } from './usePrototypeOptions'

/** One action of an interaction: its type, where it goes, and how it animates. */
const { action, nodeId } = defineProps<{ action: Action; nodeId: string | null }>()
const emit = defineEmits<{ change: [action: Action] }>()

const t = usePrototypeMessages()
const options = usePrototypeOptions(() => nodeId)

const transitionOf = (item: Action) => ('transition' in item ? item.transition : undefined)

function setType(type: Action['type']) {
  emit('change', options.defaultAction(type, transitionOf(action) ?? DEFAULT_TRANSITION))
}

function setDestination(destination: string) {
  if ('destination' in action) emit('change', { ...action, destination })
}

function setTransition(change: Partial<Transition>) {
  const transition = transitionOf(action)
  if (transition) emit('change', { ...action, transition: { ...transition, ...change } } as Action)
}
</script>

<template>
  <AppSelect
    :model-value="action.type"
    :options="options.actionOptions()"
    :label="t.action"
    data-test-id="prototype-action"
    @update:model-value="setType($event as Action['type'])"
  />
  <AppSelect
    v-if="'destination' in action"
    :model-value="action.destination"
    :options="options.destinationOptions(action)"
    :label="t.destination"
    data-test-id="prototype-destination"
    @update:model-value="setDestination(String($event))"
  />
  <input
    v-if="action.type === 'open-url'"
    type="url"
    dir="ltr"
    class="h-6 rounded bg-input px-1.5 text-[11px]"
    :aria-label="t.url"
    :value="action.url"
    @change="emit('change', { type: 'open-url', url: ($event.target as HTMLInputElement).value })"
  />
  <PrototypeSectionVariableAction
    v-if="action.type === 'set-variable'"
    :action="action"
    @change="emit('change', $event)"
  />
  <p v-if="action.type === 'conditional'" class="text-[11px] text-muted">
    {{
      t.conditionSummary({
        count: action.when.length,
        then: action.actions.length,
        otherwise: action.otherwise?.length ?? 0
      })
    }}
  </p>
  <PrototypeSectionTransition
    v-if="transitionOf(action)"
    :transition="transitionOf(action) ?? DEFAULT_TRANSITION"
    @change="setTransition"
  />
</template>
