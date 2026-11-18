<script setup lang="ts">
import { useElementSize } from '@vueuse/core'
import { computed, onMounted, ref, shallowRef, toRef, useTemplateRef } from 'vue'
import { useRouter } from 'vue-router'

import type { CloudDocumentKind, RoomAccessMode, RoomFile } from '@lawha/cloud/contract'
import { useCloudMessages, useCommonMessages } from '@lawha/vue/i18n'

import { useCloudRoomPresence } from '@/app/cloud/room-tree/presence'
import { useCloudRooms, type RoomFailure } from '@/app/cloud/room-tree/store'
import { cloudConnection } from '@/app/cloud/sessions/connection'
import AppConfirmationDialog from '@/components/ui/dialog/AppConfirmationDialog.vue'
import { useHeldContent } from '@/components/ui/overlay/held'

import CloudRoomFormDialog, { type CloudRoomForm } from './CloudRoomFormDialog.vue'
import CloudRoomMembersDialog from './CloudRoomMembersDialog.vue'
import CloudRoomMoveDialog, { type CloudRoomMove } from './CloudRoomMoveDialog.vue'
import CloudRoomPage from './CloudRoomPage.vue'
import CloudRoomTree from './CloudRoomTree.vue'
import { CLOUD_ROOMS_SPLIT_WIDTH, cloudRooms } from './ui'

/**
 * Rooms on Home for the server Home shows: the tree of rooms the person may enter beside the
 * room they opened. On a narrow screen the two take turns, the room offering a way back.
 */
const {
  serverId,
  workspaces = [],
  query = ''
} = defineProps<{
  serverId: string
  /** The person's workspaces, where they may make top-level rooms when they write in one. */
  workspaces?: { id: string; name: string; role: 'viewer' | 'editor' | 'admin' }[]
  /** Home's search, already lowercased in the app's locale. */
  query?: string
}>()

const ui = cloudRooms()
const router = useRouter()
const t = useCloudMessages()
const common = useCommonMessages()
const rooms = useCloudRooms(toRef(() => serverId))
const presence = useCloudRoomPresence(
  toRef(() => serverId),
  computed(() => (rooms.pageState.value === 'ready' ? rooms.selected.value : null))
)
const self = computed(() => cloudConnection(serverId).account?.id ?? null)
const root = useTemplateRef<HTMLElement>('root')
const { width } = useElementSize(root)
const compact = computed(() => width.value > 0 && width.value < CLOUD_ROOMS_SPLIT_WIDTH)
const writable = computed(() => workspaces.filter((workspace) => workspace.role !== 'viewer'))
onMounted(() => void rooms.refresh())

const FAILURE_TEXT = {
  forbidden: 'roomsFailureForbidden',
  'not-found': 'roomsFailureNotFound',
  invalid: 'roomsFailureInvalid',
  'already-member': 'roomsFailureAlreadyMember',
  unavailable: 'roomsFailureUnavailable'
} as const satisfies Record<RoomFailure, string>
const failure = computed(() => {
  const current = rooms.failure.value
  return current ? t.value[FAILURE_TEXT[current]] : null
})
const room = computed(() => rooms.detail.value?.room ?? null)

// Dialogs
const membersOpen = ref(false)
async function openMembers() {
  rooms.clearFailure()
  rooms.invitationLink.value = null
  await rooms.loadMembers()
  membersOpen.value = true
}
const form = shallowRef<CloudRoomForm | null>(null)
const formOpen = computed({
  get: () => form.value !== null,
  set: (open: boolean) => {
    if (!open) form.value = null
  }
})
function openForm(next: CloudRoomForm) {
  rooms.clearFailure()
  form.value = next
}
async function submitForm(input: {
  name: string
  workspaceId?: string
  accessMode?: RoomAccessMode
}) {
  const current = form.value
  const roomId = room.value?.id
  let done = false
  if (current?.kind === 'create')
    done = await rooms.create({ name: input.name, workspaceId: input.workspaceId })
  else if (current?.kind === 'create-sub' && roomId) {
    done = await rooms.create({ name: input.name, parentId: roomId, accessMode: input.accessMode })
  } else if (current?.kind === 'rename' && roomId) done = await rooms.rename(roomId, input.name)
  if (done) form.value = null
}
const moving = shallowRef<CloudRoomMove | null>(null)
const moveOpen = computed({
  get: () => moving.value !== null,
  set: (open: boolean) => {
    if (!open) moving.value = null
  }
})
function moveFile(file: RoomFile) {
  const fromRoomId = room.value?.id
  if (!fromRoomId) return
  rooms.clearFailure()
  moving.value = {
    kind: 'file',
    documentId: file.document.id,
    name: file.document.name,
    fromRoomId,
    workspaceId: file.document.workspaceId
  }
}
function moveRoom() {
  if (!room.value) return
  rooms.clearFailure()
  moving.value = { kind: 'room', room: room.value }
}
async function submitMove(targetId: string | null) {
  const current = moving.value
  let done = false
  if (current?.kind === 'room') done = await rooms.move(current.room.id, targetId)
  else if (current?.kind === 'file' && targetId) {
    done = await rooms.moveFile(current.documentId, targetId)
  }
  if (done) moving.value = null
}

/** Archiving, leaving, and taking a file out of a room are asked once more. */
const confirming = ref<
  { kind: 'archive' } | { kind: 'leave' } | { kind: 'remove-file'; file: RoomFile } | null
>(null)
const confirmingShown = useHeldContent(confirming)
const confirmation = computed(() => {
  const pending = confirmingShown.value
  const name = room.value?.name ?? ''
  if (!pending) return null
  if (pending.kind === 'archive') {
    return {
      heading: t.value.roomsArchiveHeading({ room: name }),
      description: t.value.roomsArchiveDescription,
      confirm: t.value.roomsArchive
    }
  }
  if (pending.kind === 'leave') {
    return {
      heading: t.value.roomsLeaveHeading({ room: name }),
      description: t.value.roomsLeaveDescription,
      confirm: t.value.roomsLeave
    }
  }
  return {
    heading: pending.file.document.name,
    description: undefined,
    confirm: t.value.roomsRemoveFile
  }
})
async function confirm() {
  const pending = confirming.value
  const roomId = room.value?.id
  confirming.value = null
  if (!pending || !roomId) return
  if (pending.kind === 'archive') await rooms.setArchived(roomId, true)
  else if (pending.kind === 'leave') await rooms.leave(roomId)
  else await rooms.removeFile(roomId, pending.file.document.id)
}
function archive(archived: boolean) {
  const roomId = room.value?.id
  if (archived) confirming.value = { kind: 'archive' }
  else if (roomId) void rooms.setArchived(roomId, false)
}
async function newFile(kind: CloudDocumentKind) {
  const roomId = room.value?.id
  if (!roomId) return
  // A text document opens in the document editor; designs and boards open in tabs.
  if ((await rooms.createFile(roomId, kind, t.value.roomsUntitled)) && kind === 'writer') {
    await router.push('/writer')
  }
}
async function openFile(file: RoomFile) {
  if ((await rooms.openFile(file)) === 'writer') await router.push('/writer')
}
</script>

<template>
  <div ref="root" :class="ui.root()" data-test-id="cloud-rooms">
    <div :class="ui.split()">
      <CloudRoomTree
        v-if="!compact || !rooms.selected.value"
        v-model:archived="rooms.showArchived.value"
        :rooms="rooms.rooms.value"
        :state="rooms.treeState.value"
        :selected="rooms.selected.value"
        :can-create="writable.length > 0"
        :query="query"
        :full="compact"
        @select="rooms.select"
        @create="openForm({ kind: 'create', workspaces: writable })"
        @refresh="rooms.refresh"
      />
      <CloudRoomPage
        v-if="!compact || rooms.selected.value"
        :detail="rooms.detail.value"
        :state="rooms.pageState.value"
        :people="presence.people.value"
        :failure="membersOpen || formOpen || moveOpen ? null : failure"
        :busy="rooms.busy.value"
        :compact="compact"
        :query="query"
        @select="rooms.select"
        @back="rooms.select(null)"
        @retry="rooms.refresh"
        @members="openMembers"
        @new-sub-room="room && openForm({ kind: 'create-sub', parentName: room.name })"
        @new-file="newFile"
        @rename="room && openForm({ kind: 'rename', name: room.name })"
        @move="moveRoom"
        @archive="archive"
        @leave="confirming = { kind: 'leave' }"
        @open-file="openFile"
        @move-file="moveFile"
        @remove-file="(file) => (confirming = { kind: 'remove-file', file })"
      />
    </div>
    <CloudRoomMembersDialog
      v-model:open="membersOpen"
      :room="room"
      :members="rooms.members.value"
      :audit="rooms.audit.value"
      :self="self"
      :busy="rooms.busy.value"
      :failure="failure"
      :invitation-link="rooms.invitationLink.value"
      @invite="rooms.invite"
      @revoke="rooms.revoke"
      @change-role="rooms.changeRole"
      @remove="rooms.removeMember"
      @transfer="rooms.transfer"
      @set-access="(mode) => room && rooms.setAccess(room.id, mode)"
    />
    <CloudRoomFormDialog
      v-model:open="formOpen"
      :form="form"
      :busy="rooms.busy.value"
      :failure="failure"
      @submit="submitForm"
    />
    <CloudRoomMoveDialog
      v-model:open="moveOpen"
      :move="moving"
      :rooms="rooms.rooms.value"
      :busy="rooms.busy.value"
      :failure="failure"
      @submit="submitMove"
    />
    <AppConfirmationDialog
      :open="confirming !== null"
      tone="danger"
      :heading="confirmation?.heading ?? ''"
      :description="confirmation?.description"
      :cancel-label="common.cancel"
      :confirm-label="confirmation?.confirm ?? ''"
      @update:open="(isOpen) => !isOpen && (confirming = null)"
      @confirm="confirm"
    />
  </div>
</template>
