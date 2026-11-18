<script setup lang="ts">
import { ref } from 'vue'

import { useCloudMessages } from '@lawha/vue/i18n'

import type { RoomTreeNode } from '@/app/cloud/room-tree/tree'
import Tip from '@/components/ui/overlay/Tip.vue'

import { cloudRooms } from './ui'

/** One room in the tree, with its sub-rooms under it, folded open until the person folds it. */
const {
  node,
  depth = 0,
  selected = null
} = defineProps<{
  node: RoomTreeNode
  depth?: number
  selected?: string | null
}>()
const emit = defineEmits<{ select: [roomId: string] }>()

const ui = cloudRooms()
const t = useCloudMessages()
const open = ref(true)
</script>

<template>
  <li
    role="treeitem"
    :aria-expanded="node.children.length ? open : undefined"
    :aria-selected="selected === node.room.id"
  >
    <div
      :class="ui.treeItem()"
      :data-active="selected === node.room.id"
      :style="{ paddingInlineStart: `${depth * 12 + 6}px` }"
    >
      <button
        v-if="node.children.length"
        type="button"
        :class="ui.treeToggle()"
        :aria-label="open ? t.roomsCollapse : t.roomsExpand"
        @click="open = !open"
      >
        <icon-lucide-chevron-down v-if="open" class="size-3" />
        <icon-lucide-chevron-right v-else class="size-3 rtl:rotate-180" />
      </button>
      <span v-else :class="ui.treeSpacer()" />
      <button
        type="button"
        class="flex min-w-0 flex-1 items-center gap-1.5 text-start"
        v-test-id="`room-tree-${node.room.id}`"
        @click="emit('select', node.room.id)"
      >
        <icon-lucide-archive v-if="node.room.archivedAt" :class="ui.treeIcon()" />
        <icon-lucide-door-open v-else :class="ui.treeIcon()" />
        <span :class="ui.treeLabel()">{{ node.room.name }}</span>
        <Tip
          v-if="node.room.accessMode === 'restricted' && node.room.parentId"
          :label="t.roomsRestricted"
        >
          <icon-lucide-lock :class="ui.treeIcon()" role="img" :aria-label="t.roomsRestricted" />
        </Tip>
        <span v-if="node.room.fileCount" :class="ui.treeMeta()">{{ node.room.fileCount }}</span>
      </button>
    </div>
    <ul v-if="node.children.length && open" role="group" :class="ui.treeList()">
      <CloudRoomTreeItem
        v-for="child in node.children"
        :key="child.room.id"
        :node="child"
        :depth="depth + 1"
        :selected="selected"
        @select="(roomId) => emit('select', roomId)"
      />
    </ul>
  </li>
</template>
