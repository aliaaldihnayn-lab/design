<script setup lang="ts">
import { computed, ref } from 'vue'

import { useHistoryMessages } from '@lawha/vue/i18n'

import type { CloudEditSession } from '@/app/cloud/versions/sessions'
import { useDateFormat } from '@/app/i18n/date'
import { describeHistoryChange } from '@/components/history/describe'
import HistoryAvatar from '@/components/history/HistoryAvatar.vue'
import { historyPanel } from '@/components/history/ui'

/**
 * One person's sitting of edits between two versions, as the server logged them: their name, how
 * many edits and when, opening onto each edit in the reader's language.
 */
const { session } = defineProps<{ session: CloudEditSession }>()

const t = useHistoryMessages()
const ui = historyPanel()
const dates = useDateFormat()
const open = ref(false)

const author = computed(() => ({
  id: session.author.id,
  name: session.author.name ?? '',
  avatarUrl: null,
  color: null
}))
const newestFirst = computed(() => session.changes.toReversed())
</script>

<template>
  <li :class="ui.session()" data-slot="version-session">
    <button
      type="button"
      :class="ui.sessionButton()"
      :aria-expanded="open"
      :aria-label="open ? t.hideChanges : t.showChanges"
      @click="open = !open"
    >
      <icon-lucide-chevron-right
        class="size-3 shrink-0 text-muted transition-transform rtl:-scale-x-100"
        :class="{ 'rotate-90 rtl:rotate-90': open }"
        aria-hidden="true"
      />
      <HistoryAvatar :author="author" :fallback-name="t.unknownAuthor" />
      <span :class="ui.body()">
        <span :class="ui.title()">{{ session.author.name || t.unknownAuthor }}</span>
        <span :class="ui.meta()">
          {{ t.sessionChanges(session.changes.length) }} · {{ dates.timeOrDay(session.at) }}
        </span>
      </span>
    </button>
    <ol v-if="open" :class="ui.changes()">
      <li
        v-for="change in newestFirst"
        :key="change.id"
        :class="ui.change()"
        data-slot="version-session-change"
      >
        <span :class="ui.changeText()">{{ describeHistoryChange(change.summary, t) }}</span>
        <span :class="ui.changeTime()">{{ dates.format(change.at, 'time') }}</span>
      </li>
    </ol>
  </li>
</template>
