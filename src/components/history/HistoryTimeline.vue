<script setup lang="ts">
import { getLocalTimeZone, today } from '@internationalized/date'
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuTrigger
} from 'reka-ui'
import { computed, ref } from 'vue'

import type { DocumentHistory, HistoryVersion } from '@lawha/core/history'
import { useHistoryMessages } from '@lawha/vue/i18n'

import { historyTimeline, type HistorySessionEntry } from '@/app/history/timeline'
import { useDateFormat } from '@/app/i18n/date'
import IconButton from '@/components/ui/button/IconButton.vue'
import { useMenuUI } from '@/components/ui/menu/menu'
import MenuScrollArea from '@/components/ui/menu/MenuScrollArea.vue'

import { describeHistoryChange } from './describe'
import HistoryAvatar from './HistoryAvatar.vue'
import { historyPanel } from './ui'

/**
 * A document's history as a timeline, newest first: the current version, then each day's
 * versions and sessions of edits, each session opening onto the edits it holds.
 */
const {
  history,
  revision,
  selectedId,
  canEdit = true,
  unit = 'layers'
} = defineProps<{
  history: DocumentHistory
  /** Changes whenever the history does, so the timeline is listed again. */
  revision: unknown
  /** The version shown, or null for the current one. */
  selectedId: string | null
  canEdit?: boolean
  unit?: 'layers' | 'paragraphs'
}>()

const emit = defineEmits<{
  select: [versionId: string | null]
  restore: [version: HistoryVersion]
  duplicate: [version: HistoryVersion]
  compare: [version: HistoryVersion]
  edit: [version: HistoryVersion]
  removeName: [version: HistoryVersion]
}>()

const t = useHistoryMessages()
const ui = historyPanel()
const menuCls = useMenuUI({ content: 'min-w-52', item: 'justify-start gap-2' })
const dates = useDateFormat()
const timeZone = getLocalTimeZone()
const open = ref(new Set<string>())

const days = computed(() => {
  void revision
  return historyTimeline(history, timeZone)
})
const empty = computed(() => days.value.length === 0)

function dayLabel(day: (typeof days.value)[number]['day']) {
  const now = today(timeZone)
  if (day.compare(now) === 0) return t.value.today
  if (day.compare(now.subtract({ days: 1 })) === 0) return t.value.yesterday
  return dates.format(day.toDate(timeZone), 'date')
}

const versionsById = computed(() => {
  void revision
  return new Map(history.listVersions().map((version) => [version.id, version]))
})

function titleOf(version: HistoryVersion) {
  if (version.title) return version.title
  if (version.kind === 'restore') {
    const source = version.restoredFromId ? versionsById.value.get(version.restoredFromId) : null
    return source?.title ? t.value.restored({ name: source.title }) : t.value.restoredUnnamed
  }
  return dates.timeOrDay(version.at)
}

function toggle(session: HistorySessionEntry) {
  const next = new Set(open.value)
  if (next.has(session.id)) next.delete(session.id)
  else next.add(session.id)
  open.value = next
}
</script>

<template>
  <ul :class="ui.list()" :aria-label="t.panelTitle" data-slot="history-timeline">
    <li :class="ui.item()" :data-selected="selectedId === null || undefined">
      <button
        type="button"
        :class="ui.itemButton()"
        :data-selected="selectedId === null || undefined"
        :aria-current="selectedId === null || undefined"
        @click="emit('select', null)"
      >
        <span :class="ui.marker()" aria-hidden="true"><span :class="ui.ring()" /></span>
        <span :class="ui.body()"
          ><span :class="ui.current()">{{ t.currentVersion }}</span></span
        >
      </button>
    </li>
    <template v-for="group in days" :key="group.day.toString()">
      <li :class="ui.day()" role="presentation">{{ dayLabel(group.day) }}</li>
      <template
        v-for="entry in group.entries"
        :key="entry.kind === 'version' ? entry.version.id : entry.id"
      >
        <li
          v-if="entry.kind === 'version'"
          :class="ui.item()"
          :data-selected="selectedId === entry.version.id || undefined"
          data-slot="history-version"
          :data-kind="entry.version.kind"
        >
          <button
            type="button"
            :class="ui.itemButton()"
            :data-selected="selectedId === entry.version.id || undefined"
            :aria-current="selectedId === entry.version.id || undefined"
            @click="emit('select', entry.version.id)"
          >
            <span :class="ui.marker()" aria-hidden="true">
              <span :class="entry.version.kind === 'auto' ? ui.dot() : ui.ring()" />
            </span>
            <span :class="ui.body()">
              <span :class="ui.title()">{{ titleOf(entry.version) }}</span>
              <span v-if="entry.version.description" :class="ui.description()">
                {{ entry.version.description }}
              </span>
              <span :class="ui.meta()">
                <HistoryAvatar :author="entry.version.author" :fallback-name="t.unknownAuthor" />
                <span>{{ entry.version.author.name || t.unknownAuthor }}</span>
                <span v-if="entry.version.title">· {{ dates.timeOrDay(entry.version.at) }}</span>
              </span>
            </span>
          </button>
          <span v-if="canEdit" :class="ui.actions()">
            <DropdownMenuRoot :modal="false">
              <DropdownMenuTrigger as-child>
                <IconButton :label="t.versionOptions">
                  <icon-lucide-ellipsis class="size-3.5" />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuPortal>
                <DropdownMenuContent :class="menuCls.content" align="end" :side-offset="4">
                  <MenuScrollArea>
                    <DropdownMenuItem :class="menuCls.item" @select="emit('edit', entry.version)">
                      {{ entry.version.title ? t.editVersionInfo : t.nameVersion }}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      :class="menuCls.item"
                      @select="emit('restore', entry.version)"
                    >
                      {{ t.restore }}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      :class="menuCls.item"
                      @select="emit('compare', entry.version)"
                    >
                      {{ t.compare }}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      :class="menuCls.item"
                      @select="emit('duplicate', entry.version)"
                    >
                      {{ t.duplicate }}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      v-if="entry.version.title && entry.version.kind === 'named'"
                      :class="menuCls.item"
                      @select="emit('removeName', entry.version)"
                    >
                      {{ t.removeName }}
                    </DropdownMenuItem>
                  </MenuScrollArea>
                </DropdownMenuContent>
              </DropdownMenuPortal>
            </DropdownMenuRoot>
          </span>
        </li>
        <li v-else :class="ui.session()" data-slot="history-session">
          <button
            type="button"
            :class="ui.sessionButton()"
            :aria-expanded="open.has(entry.id)"
            :aria-label="open.has(entry.id) ? t.hideChanges : t.showChanges"
            @click="toggle(entry)"
          >
            <icon-lucide-chevron-right
              class="size-3 shrink-0 text-muted transition-transform rtl:-scale-x-100"
              :class="{ 'rotate-90 rtl:rotate-90': open.has(entry.id) }"
              aria-hidden="true"
            />
            <HistoryAvatar :author="entry.author" :fallback-name="t.unknownAuthor" />
            <span :class="ui.body()">
              <span :class="ui.title()">{{ entry.author.name || t.unknownAuthor }}</span>
              <span :class="ui.meta()">
                {{ t.sessionChanges(entry.changes.length) }} · {{ dates.timeOrDay(entry.at) }}
              </span>
            </span>
          </button>
          <ol v-if="open.has(entry.id)" :class="ui.changes()">
            <li
              v-for="change in [...entry.changes].reverse()"
              :key="change.id"
              :class="ui.change()"
              data-slot="history-change"
            >
              <span :class="ui.changeText()">{{
                describeHistoryChange(change.summary, t, unit)
              }}</span>
              <span :class="ui.changeTime()">{{ dates.format(change.at, 'time') }}</span>
            </li>
          </ol>
        </li>
      </template>
    </template>
    <li v-if="empty" :class="ui.status()" role="presentation">{{ t.empty }}</li>
  </ul>
</template>
