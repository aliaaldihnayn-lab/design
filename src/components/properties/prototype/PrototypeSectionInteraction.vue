<script setup lang="ts">
import type { Interaction, Trigger } from '@lawha/core/prototype'
import { usePrototypeMessages } from '@lawha/vue/i18n'

import IconButton from '@/components/ui/button/IconButton.vue'
import AppSelect from '@/components/ui/select/AppSelect.vue'

import PrototypeSectionAction from './PrototypeSectionAction.vue'
import { usePrototypeOptions } from './usePrototypeOptions'

/** One interaction of a layer: what starts it and the action it runs. */
const { interaction, nodeId } = defineProps<{ interaction: Interaction; nodeId: string | null }>()
const emit = defineEmits<{ change: [interaction: Interaction]; remove: [] }>()

const t = usePrototypeMessages()
const { triggerOptions } = usePrototypeOptions(() => nodeId)

function defaultTrigger(type: Trigger['type']): Trigger {
  if (type === 'after-delay') return { type, delay: 1000 }
  if (type === 'key') return { type, key: 'Enter' }
  return { type }
}

function setTrigger(trigger: Trigger) {
  emit('change', { ...interaction, trigger })
}

function setDelay(value: string) {
  setTrigger({ type: 'after-delay', delay: Math.max(0, Math.min(60000, Number(value) || 0)) })
}

function setKey(key: string) {
  if (key) setTrigger({ type: 'key', key })
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
        @update:model-value="setTrigger(defaultTrigger($event as Trigger['type']))"
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
      @change="setDelay(($event.target as HTMLInputElement).value)"
    />
    <input
      v-if="interaction.trigger.type === 'key'"
      class="h-6 rounded bg-input px-1.5 text-[11px]"
      :aria-label="t.key"
      :value="interaction.trigger.key"
      @change="setKey(($event.target as HTMLInputElement).value)"
    />
    <PrototypeSectionAction
      :action="interaction.action"
      :node-id="nodeId"
      @change="emit('change', { ...interaction, action: $event })"
    />
  </div>
</template>
