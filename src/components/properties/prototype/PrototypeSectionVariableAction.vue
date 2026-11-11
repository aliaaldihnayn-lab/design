<script setup lang="ts">
import { computed } from 'vue'

import type { Action } from '@lawha/core/prototype'
import { usePrototypeMessages } from '@lawha/vue/i18n'

import { useEditorStore } from '@/app/editor/active-store'
import AppSelect from '@/components/ui/select/AppSelect.vue'

type SetVariable = Extract<Action, { type: 'set-variable' }>

/** A Set variable action: which variable, and the value it takes, or that it toggles. */
const { action } = defineProps<{ action: SetVariable }>()
const emit = defineEmits<{ change: [action: SetVariable] }>()

const store = useEditorStore()
const t = usePrototypeMessages()

/** Variables a prototype can set: the ones holding text, numbers, or true and false. */
const variables = computed(() => {
  void store.state.sceneVersion
  return [...store.graph.variables.values()].filter((variable) => variable.type !== 'COLOR')
})
const variableOptions = computed(() =>
  variables.value.map((variable) => ({ value: variable.id, label: variable.name }))
)
const selected = computed(() => store.graph.variables.get(action.variable))

const TOGGLE = '\u0000toggle'
const booleanOptions = computed(() => [
  { value: 'true', label: 'true' },
  { value: 'false', label: 'false' },
  { value: TOGGLE, label: t.value.toggleValue }
])

function setVariable(variable: string) {
  emit('change', { type: 'set-variable', variable, value: undefined })
}

function setBoolean(value: string) {
  if (value === TOGGLE)
    emit('change', { type: 'set-variable', variable: action.variable, toggle: true })
  else emit('change', { type: 'set-variable', variable: action.variable, value: value === 'true' })
}

function setText(text: string) {
  const number = Number(text)
  const value = selected.value?.type === 'FLOAT' && Number.isFinite(number) ? number : text
  emit('change', { type: 'set-variable', variable: action.variable, value })
}
</script>

<template>
  <p v-if="variables.length === 0" class="text-[11px] text-muted">{{ t.noVariables }}</p>
  <template v-else>
    <AppSelect
      :model-value="action.variable"
      :options="variableOptions"
      :label="t.variable"
      @update:model-value="setVariable(String($event))"
    />
    <AppSelect
      v-if="selected?.type === 'BOOLEAN'"
      :model-value="action.toggle ? TOGGLE : String(action.value ?? false)"
      :options="booleanOptions"
      :label="t.value"
      @update:model-value="setBoolean(String($event))"
    />
    <input
      v-else-if="selected"
      class="h-6 rounded bg-input px-1.5 text-[11px]"
      :type="selected.type === 'FLOAT' ? 'number' : 'text'"
      :aria-label="t.value"
      :value="action.value ?? ''"
      @change="setText(($event.target as HTMLInputElement).value)"
    />
  </template>
</template>
