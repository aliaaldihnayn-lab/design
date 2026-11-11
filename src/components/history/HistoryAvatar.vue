<script setup lang="ts">
import { computed } from 'vue'

import type { HistoryAuthor } from '@lawha/core/history'

import Tip from '@/components/ui/overlay/Tip.vue'

import { authorColor, authorInitials } from './describe'
import { historyPanel } from './ui'

/** An author's picture, or their initials on a colour of their own. */
const { author } = defineProps<{ author: HistoryAuthor; fallbackName: string }>()
const ui = historyPanel()
const name = computed(() => author.name || '')
</script>

<template>
  <Tip :label="name || fallbackName">
    <span
      :class="ui.avatar()"
      :style="{ backgroundColor: authorColor(name || fallbackName, author.color) }"
      data-slot="history-avatar"
    >
      <img v-if="author.avatarUrl" :src="author.avatarUrl" alt="" :class="ui.avatarImage()" />
      <template v-else>{{ authorInitials(name || fallbackName) }}</template>
    </span>
  </Tip>
</template>
