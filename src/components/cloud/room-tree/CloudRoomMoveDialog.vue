<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import type { RoomSummary } from '@lawha/cloud/contract'
import { useCloudMessages, useCommonMessages, useI18n } from '@lawha/vue/i18n'

import { buildRoomTree, flattenRoomTree, roomDescendants } from '@/app/cloud/room-tree/tree'
import AppButton from '@/components/ui/button/AppButton.vue'
import AppDialogBody from '@/components/ui/dialog/AppDialogBody.vue'
import AppDialogFooter from '@/components/ui/dialog/AppDialogFooter.vue'
import AppDialogHeader from '@/components/ui/dialog/AppDialogHeader.vue'
import AppDialogRoot from '@/components/ui/dialog/AppDialogRoot.vue'
import AppAlert from '@/components/ui/feedback/AppAlert.vue'
import { useHeldContent } from '@/components/ui/overlay/held'

import { cloudRooms } from './ui'

/**
 * Where a room or a file goes. A file goes to another room of its workspace the person edits; a
 * room also may go to the top level, but never inside itself.
 */
export type CloudRoomMove =
  | { kind: 'room'; room: RoomSummary }
  | { kind: 'file'; documentId: string; name: string; fromRoomId: string; workspaceId: string }

const {
  move = null,
  rooms,
  busy = false,
  failure = null
} = defineProps<{
  move?: CloudRoomMove | null
  rooms: RoomSummary[]
  busy?: boolean
  failure?: string | null
}>()
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ submit: [targetId: string | null] }>()

const ui = cloudRooms()
const t = useCloudMessages()
const common = useCommonMessages()
const { locale } = useI18n()
const shown = useHeldContent(() => move, open)
const target = ref<string | null | undefined>(undefined)
watch(open, (isOpen) => {
  if (isOpen) target.value = undefined
})
const choices = computed(() => {
  const current = shown.value
  if (!current) return []
  const workspaceId = current.kind === 'room' ? current.room.workspaceId : current.workspaceId
  const excluded =
    current.kind === 'room'
      ? roomDescendants(rooms, current.room.id)
      : new Set([current.fromRoomId])
  const writable = rooms.filter(
    (room) => room.workspaceId === workspaceId && room.role !== 'viewer' && room.archivedAt === null
  )
  return flattenRoomTree(buildRoomTree(writable, locale.value)).map((entry) => ({
    ...entry,
    disabled:
      excluded.has(entry.room.id) ||
      (current.kind === 'room' && entry.room.id === current.room.parentId)
  }))
})
const name = computed(() => {
  const current = shown.value
  if (!current) return ''
  return current.kind === 'room' ? current.room.name : current.name
})
</script>

<template>
  <AppDialogRoot v-model:open="open" size="sm">
    <AppDialogHeader
      :heading="t.roomsMoveHeading({ name })"
      :description="t.roomsMoveDescription"
      :close-label="common.close"
    />
    <AppDialogBody>
      <div class="flex flex-col gap-3">
        <AppAlert v-if="failure" tone="error" :heading="failure" />
        <div :class="ui.choice()" role="listbox" :aria-label="t.roomsMoveDescription">
          <button
            v-if="shown?.kind === 'room' && shown.room.parentId !== null"
            type="button"
            role="option"
            :class="ui.choiceItem()"
            :aria-selected="target === null"
            :data-active="target === null"
            @click="target = null"
          >
            <icon-lucide-layers class="size-3.5 shrink-0 text-muted" />
            {{ t.roomsMoveTop }}
          </button>
          <button
            v-for="choice in choices"
            :key="choice.room.id"
            type="button"
            role="option"
            :class="ui.choiceItem()"
            :disabled="choice.disabled"
            :aria-selected="target === choice.room.id"
            :data-active="target === choice.room.id"
            :style="{ paddingInlineStart: `${choice.depth * 14 + 8}px` }"
            @click="target = choice.room.id"
          >
            <icon-lucide-door-open class="size-3.5 shrink-0 text-muted" />
            <span class="min-w-0 flex-1 truncate">{{ choice.room.name }}</span>
          </button>
        </div>
      </div>
    </AppDialogBody>
    <AppDialogFooter>
      <AppButton variant="ghost" @click="open = false">{{ common.cancel }}</AppButton>
      <AppButton
        color="primary"
        variant="solid"
        :disabled="target === undefined"
        :loading="busy"
        @click="target !== undefined && emit('submit', target)"
      >
        {{ t.roomsMoveHere }}
      </AppButton>
    </AppDialogFooter>
  </AppDialogRoot>
</template>
