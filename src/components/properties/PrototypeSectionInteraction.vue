<script setup lang="ts">
import { computed } from 'vue'

import {
  TRIGGERS,
  type Action,
  type Interaction,
  type Transition,
  type Trigger
} from '@lawha/core/prototype'
import { usePrototypeMessages } from '@lawha/vue/i18n'

import { useEditorStore } from '@/app/editor/active-store'
import IconButton from '@/components/ui/button/IconButton.vue'
import AppSelect from '@/components/ui/select/AppSelect.vue'

import {
  DEFAULT_TRANSITION,
  clampNumber,
  defaultAction,
  defaultTrigger,
  optionLabel,
  transitionOf,
  type PrototypeOption
} from './prototype/interaction'
import PrototypeSectionTransition from './PrototypeSectionTransition.vue'
import PrototypeSectionVariableAction from './PrototypeSectionVariableAction.vue'

/** One interaction of the selected layer: its trigger, action, and the action's transition. */
const { interaction, nodeId, screenOptions, variantOptions, nextDestination } = defineProps<{
  interaction: Interaction
  nodeId: string
  screenOptions: PrototypeOption[]
  variantOptions: PrototypeOption[]
  /** The screen a new navigation goes to. */
  nextDestination: string
}>()
const emit = defineEmits<{ change: [interaction: Interaction]; remove: [] }>()

const store = useEditorStore()
const t = usePrototypeMessages()

const triggerOptions = computed(() =>
  TRIGGERS.map((v) => ({ value: v, label: optionLabel(t.value, 'trigger', v) }))
)
const actionOptions = computed(() =>
  (
    [
      'navigate',
      'back',
      'overlay',
      'close-overlay',
      'open-url',
      'set-variable',
      ...(variantOptions.length > 1 ? (['change-to'] as const) : [])
    ] as const
  ).map((v) => ({ value: v, label: optionLabel(t.value, 'action', v) }))
)
const destinationOptions = computed(() =>
  interaction.action.type === 'change-to' ? variantOptions : screenOptions
)
const transition = computed(() => transitionOf(interaction))

const change = (next: Partial<Interaction>) => emit('change', { ...interaction, ...next })

function setTrigger(type: Trigger['type']) {
  change({ trigger: defaultTrigger(type) })
}

function setAction(type: Action['type']) {
  const current = interaction.action
  const kept = ('transition' in current ? current.transition : undefined) ?? DEFAULT_TRANSITION
  const variable = [...store.graph.variables.values()].find((item) => item.type !== 'COLOR')
  const otherVariant = variantOptions.find(
    (option) => !store.graph.closest(nodeId, (node) => node.id === option.value)
  )?.value
  change({
    action: defaultAction(type, {
      destination: nextDestination,
      transition: kept,
      variable,
      otherVariant
    })
  })
}

function setDestination(destination: string) {
  if ('destination' in interaction.action)
    change({ action: { ...interaction.action, destination } })
}

function setTransition(next: Partial<Transition>) {
  const action = interaction.action
  if (!('transition' in action) || !action.transition) return
  change({ action: { ...action, transition: { ...action.transition, ...next } } as Action })
}

function setKey(key: string) {
  if (key) change({ trigger: { type: 'key', key } })
}
</script>

<template>
  <div
    class="flex flex-col gap-1 rounded border border-border p-1.5"
    data-test-id="prototype-interaction"
  >
    <div class="flex items-center gap-1">
      <AppSelect
        :model-value="interaction.trigger.type"
        :options="triggerOptions"
        :label="t.trigger"
        :ui="{ trigger: 'w-auto min-w-0 flex-1' }"
        data-test-id="prototype-trigger"
        @update:model-value="setTrigger($event as Trigger['type'])"
      />
      <IconButton :label="t.remove" @click="emit('remove')">
        <icon-lucide-minus class="size-3.5" />
      </IconButton>
    </div>
    <input
      v-if="interaction.trigger.type === 'after-delay'"
      type="number"
      min="0"
      step="100"
      class="h-6 rounded bg-input px-1.5 text-[11px]"
      :aria-label="t.delay"
      :value="interaction.trigger.delay"
      @change="
        change({
          trigger: {
            type: 'after-delay',
            delay: clampNumber(($event.target as HTMLInputElement).value, 60000)
          }
        })
      "
    />
    <input
      v-if="interaction.trigger.type === 'key'"
      class="h-6 rounded bg-input px-1.5 text-[11px]"
      :aria-label="t.key"
      :value="interaction.trigger.key"
      @change="setKey(($event.target as HTMLInputElement).value)"
    />
    <AppSelect
      :model-value="interaction.action.type"
      :options="actionOptions"
      :label="t.action"
      data-test-id="prototype-action"
      @update:model-value="setAction($event as Action['type'])"
    />
    <AppSelect
      v-if="'destination' in interaction.action"
      :model-value="interaction.action.destination"
      :options="destinationOptions"
      :label="t.destination"
      data-test-id="prototype-destination"
      @update:model-value="setDestination(String($event))"
    />
    <input
      v-if="interaction.action.type === 'open-url'"
      type="url"
      dir="ltr"
      class="h-6 rounded bg-input px-1.5 text-[11px]"
      :aria-label="t.url"
      :value="interaction.action.url"
      @change="
        change({ action: { type: 'open-url', url: ($event.target as HTMLInputElement).value } })
      "
    />
    <PrototypeSectionVariableAction
      v-if="interaction.action.type === 'set-variable'"
      :action="interaction.action"
      @change="change({ action: $event })"
    />
    <p v-if="interaction.action.type === 'conditional'" class="text-[11px] text-muted">
      {{
        t.conditionSummary({
          count: interaction.action.when.length,
          then: interaction.action.actions.length,
          otherwise: interaction.action.otherwise?.length ?? 0
        })
      }}
    </p>
    <PrototypeSectionTransition
      v-if="transition"
      :transition="transition"
      @change="setTransition"
    />
  </div>
</template>
