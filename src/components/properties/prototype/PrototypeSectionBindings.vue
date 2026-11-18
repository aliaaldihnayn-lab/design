<script setup lang="ts">
import { computed } from 'vue'

import { readPropertyBindings } from '@lawha/core/prototype'
import type { VariableType } from '@lawha/scene-graph'
import { componentPropertyDefinitions } from '@lawha/scene-graph/components'
import { usePrototypeMessages } from '@lawha/vue/i18n'

import { useEditorStore } from '@/app/editor/active-store'
import AppSelect from '@/components/ui/select/AppSelect.vue'

import { usePrototypeTools } from './usePrototypeTools'

/**
 * What the selected layer shows from prototype variables while the design runs: a text
 * layer's text, any layer's visibility, and an instance's component properties.
 */
const { nodeId } = defineProps<{ nodeId: string }>()

const store = useEditorStore()
const t = usePrototypeMessages()
const { run } = usePrototypeTools()

const NONE = '\u0000none'

const node = computed(() => {
  void store.state.sceneVersion
  return store.graph.getNode(nodeId) ?? null
})

/** The variables a field can show, and none. */
function variableOptions(types: readonly VariableType[]) {
  return [
    { value: NONE, label: t.value.notBound },
    ...[...store.graph.variables.values()]
      .filter((variable) => types.includes(variable.type))
      .map((variable) => ({ value: variable.id, label: variable.name }))
  ]
}

interface BoundField {
  field: string
  label: string
  types: readonly VariableType[]
  bound: string | undefined
}

const fields = computed((): BoundField[] => {
  const current = node.value
  if (!current) return []
  const list: BoundField[] = [
    {
      field: 'visible',
      label: t.value.bindVisible,
      types: ['BOOLEAN', 'STRING'],
      bound: current.boundVariables.visible
    }
  ]
  if (current.type === 'TEXT')
    list.unshift({
      field: 'text',
      label: t.value.bindText,
      types: ['STRING', 'FLOAT'],
      bound: current.boundVariables.text
    })
  return list
})

/** An instance's variant, boolean, and text properties, with the variable each follows. */
const properties = computed(() => {
  const current = node.value
  if (current?.type !== 'INSTANCE') return []
  const bindings = readPropertyBindings(current)
  return componentPropertyDefinitions(store.graph, current)
    .filter((definition) => ['VARIANT', 'BOOLEAN', 'TEXT'].includes(definition.type))
    .map((definition) => {
      const binding = Object.hasOwn(bindings, definition.name)
        ? bindings[definition.name]
        : undefined
      return {
        name: definition.name,
        bound: typeof binding === 'string' ? binding : binding?.variable,
        types: (definition.type === 'TEXT'
          ? ['STRING', 'FLOAT']
          : ['BOOLEAN', 'STRING']) satisfies VariableType[]
      }
    })
})

function bindField(field: string, variable: string, bound: string | undefined) {
  if (variable === NONE) {
    if (bound) void run('unbind_variable', { node_id: nodeId, field })
  } else void run('bind_variable', { node_id: nodeId, field, variable_id: variable })
}

function bindProperty(property: string, variable: string) {
  void run('bind_property_to_variable', {
    instance_id: nodeId,
    property,
    variable: variable === NONE ? null : variable
  })
}
</script>

<template>
  <div class="mt-2 flex flex-col gap-1" data-test-id="prototype-bindings">
    <span class="text-[11px] font-semibold text-surface">{{ t.bindings }}</span>
    <AppSelect
      v-for="item in fields"
      :key="item.field"
      :model-value="item.bound ?? NONE"
      :options="variableOptions(item.types)"
      :label="item.label"
      :data-binding="item.field"
      @update:model-value="bindField(item.field, String($event), item.bound)"
    />
    <AppSelect
      v-for="item in properties"
      :key="item.name"
      :model-value="item.bound ?? NONE"
      :options="variableOptions(item.types)"
      :label="t.bindProperty({ name: item.name })"
      :data-binding="`property:${item.name}`"
      @update:model-value="bindProperty(item.name, String($event))"
    />
  </div>
</template>
