<script setup lang="ts">
import { computed } from 'vue'

import type { RoomSummary } from '@lawha/cloud/contract'
import { useCloudMessages, useCommonMessages, useI18n } from '@lawha/vue/i18n'

import { buildRoomTree } from '@/app/cloud/room-tree/tree'
import AppButton from '@/components/ui/button/AppButton.vue'
import IconButton from '@/components/ui/button/IconButton.vue'
import AppAlert from '@/components/ui/feedback/AppAlert.vue'
import AppPlaceholder from '@/components/ui/feedback/AppPlaceholder.vue'
import AppSkeleton from '@/components/ui/feedback/AppSkeleton.vue'
import AppCheckbox from '@/components/ui/toggle/AppCheckbox.vue'

import CloudRoomTreeItem from './CloudRoomTreeItem.vue'
import { cloudRooms } from './ui'

/** Every room the person may enter, nested; rooms they are kept out of never reach this list. */
const {
  rooms,
  state = 'ready',
  selected = null,
  canCreate = false,
  query = '',
  full = false
} = defineProps<{
  rooms: RoomSummary[]
  state?: 'loading' | 'ready' | 'error'
  selected?: string | null
  /** The person writes in a workspace, so may make top-level rooms. */
  canCreate?: boolean
  /** Home's search, already lowercased in the app's locale. */
  query?: string
  /** The tree takes the whole width, on a narrow screen. */
  full?: boolean
}>()
const showArchived = defineModel<boolean>('archived', { default: false })
const emit = defineEmits<{ select: [roomId: string]; create: []; refresh: [] }>()

const ui = cloudRooms()
const t = useCloudMessages()
const common = useCommonMessages()
const { locale } = useI18n()
const shown = computed(() =>
  query ? rooms.filter((room) => room.name.toLocaleLowerCase(locale.value).includes(query)) : rooms
)
const tree = computed(() => buildRoomTree(shown.value, locale.value))
</script>

<template>
  <nav :class="full ? ui.treeFull() : ui.tree()" :aria-label="t.roomsTree">
    <div :class="ui.treeHeader()">
      <h2 :class="ui.treeTitle()">{{ t.roomsTitle }}</h2>
      <IconButton :label="common.refresh" @click="emit('refresh')">
        <icon-lucide-refresh-cw class="size-3.5" />
      </IconButton>
      <IconButton
        v-if="canCreate"
        :label="t.roomsNew"
        data-test-id="rooms-new"
        @click="emit('create')"
      >
        <icon-lucide-plus class="size-3.5" />
      </IconButton>
    </div>
    <div v-if="state === 'loading' && rooms.length === 0" class="flex flex-col gap-1.5">
      <AppSkeleton v-for="index in 4" :key="index" class="h-7 w-full" />
    </div>
    <AppAlert
      v-else-if="state === 'error' && rooms.length === 0"
      tone="error"
      :heading="t.roomsLoadFailed"
      :description="t.roomsLoadFailedDescription"
    >
      <template #actions>
        <AppButton size="sm" variant="outline" @click="emit('refresh')">{{ t.tryAgain }}</AppButton>
      </template>
    </AppAlert>
    <AppPlaceholder
      v-else-if="tree.length === 0"
      size="compact"
      :fill="false"
      :label="t.roomsEmptyTree"
      :description="t.roomsEmptyTreeDescription"
    >
      <template #icon><icon-lucide-door-open class="size-5" /></template>
      <template v-if="canCreate && !query" #action>
        <AppButton size="sm" variant="outline" @click="emit('create')">{{ t.roomsNew }}</AppButton>
      </template>
    </AppPlaceholder>
    <ul v-else role="tree" :class="ui.treeList()" :aria-label="t.roomsTree">
      <CloudRoomTreeItem
        v-for="node in tree"
        :key="node.room.id"
        :node="node"
        :selected="selected"
        @select="(roomId) => emit('select', roomId)"
      />
    </ul>
    <label class="mt-1 flex items-center gap-2 text-[11px] text-muted">
      <AppCheckbox v-model="showArchived" :ariaLabel="t.roomsShowArchived" />
      <span aria-hidden="true">{{ t.roomsShowArchived }}</span>
    </label>
  </nav>
</template>
