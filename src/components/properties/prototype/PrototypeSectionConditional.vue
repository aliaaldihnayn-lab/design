<script setup lang="ts">
import { computed } from 'vue'

import type { Action, Condition } from '@lawha/core/prototype'
import { usePrototypeMessages } from '@lawha/vue/i18n'

import { useEditorStore } from '@/app/editor/active-store'
import IconButton from '@/components/ui/button/IconButton.vue'
import AppSelect from '@/components/ui/select/AppSelect.vue'

import PrototypeSectionActionFields from './PrototypeSectionActionFields.vue'
import { DEFAULT_TRANSITION, usePrototypeOptions, type SimpleAction } from './usePrototypeOptions'

type Conditional = Extract<Action, { type: 'conditional' }>
type Branch = 'actions' | 'otherwise'

/**
 * A conditional: the comparisons that must all hold, the actions it runs then, and the ones it
 * runs otherwise, as Figma's if and else blocks.
 */
const { action, nodeId } = defineProps<{ action: Conditional; nodeId: string | null }>()
const emit = defineEmits<{ change: [action: Conditional] }>()

const store = useEditorStore()
const t = usePrototypeMessages()
const options = usePrototypeOptions(() => nodeId)

const UNARY: ReadonlySet<Condition['op']> = new Set(['truthy', 'falsy'])
const branches = computed(() => [
  { id: 'actions' as const, label: t.value.conditionThen, list: action.actions },
  { id: 'otherwise' as const, label: t.value.conditionOtherwise, list: action.otherwise ?? [] }
])
const booleanOptions = [
  { value: 'true', label: 'true' },
  { value: 'false', label: 'false' }
]

const typeOf = (condition: Condition) => store.graph.variables.get(condition.variable)?.type

function setCondition(index: number, change: Partial<Condition>) {
  const when = action.when.map((item, i) => {
    if (i !== index) return item
    const next = { ...item, ...change }
    return UNARY.has(next.op) ? { variable: next.variable, op: next.op } : next
  })
  emit('change', { ...action, when })
}

/** A typed comparison value: a number for a number variable, true or false for a boolean. */
function setValue(index: number, text: string) {
  const type = typeOf(action.when[index])
  const number = Number(text)
  if (type === 'BOOLEAN') setCondition(index, { value: text === 'true' })
  else setCondition(index, { value: type === 'FLOAT' && Number.isFinite(number) ? number : text })
}

function addCondition() {
  const variable = options.variables.value.at(0)?.id ?? ''
  emit('change', { ...action, when: [...action.when, { variable, op: 'truthy' }] })
}

function removeCondition(index: number) {
  if (action.when.length > 1)
    emit('change', { ...action, when: action.when.filter((_, i) => i !== index) })
}

function setBranch(branch: Branch, list: SimpleAction[]) {
  if (branch === 'actions') emit('change', { ...action, actions: list })
  else if (list.length > 0) emit('change', { ...action, otherwise: list })
  else {
    const { otherwise: _otherwise, ...rest } = action
    emit('change', rest)
  }
}

function branchList(branch: Branch): SimpleAction[] {
  return branch === 'actions' ? action.actions : (action.otherwise ?? [])
}

function setBranchAction(branch: Branch, index: number, next: Action) {
  if (next.type === 'conditional') return
  setBranch(
    branch,
    branchList(branch).map((item, i) => (i === index ? next : item))
  )
}

function addBranchAction(branch: Branch) {
  const added = options.defaultAction('navigate', DEFAULT_TRANSITION)
  if (added.type !== 'conditional') setBranch(branch, [...branchList(branch), added])
}
</script>

<template>
  <div
    class="flex flex-col gap-1 border-s-2 border-border ps-1.5"
    data-test-id="prototype-conditional"
  >
    <span class="text-[11px] font-semibold">{{ t.conditionIf }}</span>
    <div
      v-for="(condition, index) in action.when"
      :key="`when-${index}`"
      class="flex flex-col gap-1"
      data-test-id="prototype-condition"
    >
      <div class="flex items-center gap-1">
        <AppSelect
          :model-value="condition.variable"
          :options="options.variableOptions.value"
          :label="t.variable"
          :ui="{ trigger: 'w-auto min-w-0 flex-1' }"
          @update:model-value="setCondition(index, { variable: String($event) })"
        />
        <IconButton
          v-if="action.when.length > 1"
          :label="t.removeCondition"
          @click="removeCondition(index)"
        >
          <icon-lucide-minus class="size-3.5" />
        </IconButton>
      </div>
      <AppSelect
        :model-value="condition.op"
        :options="options.operatorOptions.value"
        :label="t.operator"
        @update:model-value="setCondition(index, { op: $event as Condition['op'] })"
      />
      <AppSelect
        v-if="!UNARY.has(condition.op) && typeOf(condition) === 'BOOLEAN'"
        :model-value="String(condition.value ?? false)"
        :options="booleanOptions"
        :label="t.value"
        @update:model-value="setValue(index, String($event))"
      />
      <input
        v-else-if="!UNARY.has(condition.op)"
        class="h-6 rounded bg-input px-1.5 text-[11px]"
        :type="typeOf(condition) === 'FLOAT' ? 'number' : 'text'"
        :aria-label="t.value"
        :value="condition.value ?? ''"
        @change="setValue(index, ($event.target as HTMLInputElement).value)"
      />
    </div>
    <IconButton
      :label="t.addCondition"
      data-test-id="prototype-add-condition"
      @click="addCondition"
    >
      <icon-lucide-plus class="size-3.5" />
    </IconButton>
    <div v-for="branch in branches" :key="branch.id" class="flex flex-col gap-1">
      <div class="flex items-center justify-between text-[11px] font-semibold">
        <span>{{ branch.label }}</span>
        <IconButton
          :label="t.addBranchAction"
          :data-branch="branch.id"
          @click="addBranchAction(branch.id)"
        >
          <icon-lucide-plus class="size-3.5" />
        </IconButton>
      </div>
      <div
        v-for="(item, index) in branch.list"
        :key="`${branch.id}-${index}`"
        class="flex flex-col gap-1 rounded border border-border p-1"
      >
        <PrototypeSectionActionFields
          :action="item"
          :node-id="nodeId"
          branch
          @change="setBranchAction(branch.id, index, $event)"
        />
        <IconButton
          :label="t.removeBranchAction"
          @click="
            setBranch(
              branch.id,
              branch.list.filter((_, i) => i !== index)
            )
          "
        >
          <icon-lucide-minus class="size-3.5" />
        </IconButton>
      </div>
    </div>
  </div>
</template>
