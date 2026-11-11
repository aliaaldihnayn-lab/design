<script setup lang="ts">
import type { Action } from '@lawha/core/prototype'

import PrototypeSectionActionFields from './PrototypeSectionActionFields.vue'
import PrototypeSectionConditional from './PrototypeSectionConditional.vue'

/** One action of an interaction, a conditional with its comparisons and branches. */
const { action, nodeId } = defineProps<{ action: Action; nodeId: string | null }>()
const emit = defineEmits<{ change: [action: Action] }>()
</script>

<template>
  <PrototypeSectionActionFields
    :action="action"
    :node-id="nodeId"
    @change="emit('change', $event)"
  />
  <PrototypeSectionConditional
    v-if="action.type === 'conditional'"
    :action="action"
    :node-id="nodeId"
    @change="emit('change', $event)"
  />
</template>
