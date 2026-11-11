<script setup lang="ts">
import { useClipboard } from '@vueuse/core'
import { computed, ref, watch } from 'vue'

import type {
  RoomAccessMode,
  RoomAudit,
  RoomAuditAction,
  RoomMemberRole,
  RoomMembers,
  RoomSummary
} from '@lawha/cloud/contract'
import { useCloudMessages, useCommonMessages } from '@lawha/vue/i18n'

import { useDateFormat } from '@/app/i18n/date'
import AccountAvatar from '@/components/presence/AccountAvatar.vue'
import AppButton from '@/components/ui/button/AppButton.vue'
import AppConfirmationDialog from '@/components/ui/dialog/AppConfirmationDialog.vue'
import AppDialogBody from '@/components/ui/dialog/AppDialogBody.vue'
import AppDialogFooter from '@/components/ui/dialog/AppDialogFooter.vue'
import AppDialogHeader from '@/components/ui/dialog/AppDialogHeader.vue'
import AppDialogRoot from '@/components/ui/dialog/AppDialogRoot.vue'
import AppAlert from '@/components/ui/feedback/AppAlert.vue'
import AppPlaceholder from '@/components/ui/feedback/AppPlaceholder.vue'
import AppInput from '@/components/ui/input/AppInput.vue'
import { useHeldContent } from '@/components/ui/overlay/held'
import AppSelect from '@/components/ui/select/AppSelect.vue'
import { AppTabsContent, AppTabsList, AppTabsRoot, AppTabsTrigger } from '@/components/ui/tabs'
import AppCheckboxCard from '@/components/ui/toggle/AppCheckboxCard.vue'

import { cloudWorkspace } from '../workspace/ui'
import { cloudRooms } from './ui'

/**
 * Who may enter a room. Everyone sees the members, those on the room's own list and those let in
 * from the room above; the owner also invites by email with a role, changes roles, removes people,
 * hands the room on, chooses whether a sub-room inherits or keeps to its own list, and reads what
 * changed.
 */
const {
  room = null,
  members = null,
  audit = null,
  self = null,
  busy = false,
  failure = null,
  invitationLink = null
} = defineProps<{
  room?: RoomSummary | null
  members?: RoomMembers | null
  audit?: RoomAudit | null
  /** The person's own user id, so their row is marked. */
  self?: string | null
  busy?: boolean
  /** Why the last change was refused, already worded. */
  failure?: string | null
  /** The link of the invitation just sent, for when the server sends no email. */
  invitationLink?: string | null
}>()
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{
  invite: [email: string, role: RoomMemberRole]
  revoke: [invitationId: string]
  changeRole: [userId: string, role: RoomMemberRole]
  remove: [userId: string]
  transfer: [userId: string]
  setAccess: [accessMode: RoomAccessMode]
}>()

const ui = cloudWorkspace()
const rooms = cloudRooms()
const t = useCloudMessages()
const common = useCommonMessages()
const dates = useDateFormat()
const { copy, copied } = useClipboard({ copiedDuring: 1500 })
const shown = useHeldContent(() => room, open)
const tab = ref('members')
const email = ref('')
const role = ref<RoomMemberRole>('editor')
watch(open, (isOpen) => {
  if (!isOpen) return
  email.value = ''
  tab.value = 'members'
})

const isOwner = computed(() => shown.value?.role === 'owner')
const roleOptions = computed(() => [
  { value: 'editor' as const, label: t.value.roleEditor },
  { value: 'viewer' as const, label: t.value.roleViewer }
])
const roleDescriptions = computed<Record<string, string>>(() => ({
  editor: t.value.roomsRoleEditorDescription,
  viewer: t.value.roomsRoleViewerDescription
}))
const memberOptions = computed(() => [
  ...roleOptions.value,
  { value: 'owner' as const, label: t.value.roomsMakeOwner },
  { value: 'remove' as const, label: t.value.shareRemoveAccess }
])
const roleLabels = computed(() => ({
  owner: t.value.roomsRoleOwner,
  editor: t.value.roleEditor,
  viewer: t.value.roleViewer
}))
const restricted = computed({
  get: () => shown.value?.accessMode === 'restricted',
  set: (value: boolean) => emit('setAccess', value ? 'restricted' : 'inherit')
})

const confirming = ref<{ kind: 'remove' | 'transfer'; userId: string; name: string } | null>(null)
const confirmingShown = useHeldContent(confirming)
const confirmation = computed(() => {
  const pending = confirmingShown.value
  const name = shown.value?.name ?? ''
  if (!pending) return null
  return pending.kind === 'transfer'
    ? {
        heading: t.value.roomsTransferHeading({ name: pending.name, room: name }),
        description: t.value.roomsTransferDescription,
        confirm: t.value.roomsMakeOwner
      }
    : {
        heading: t.value.roomsRemoveHeading({ name: pending.name, room: name }),
        description: t.value.roomsRemoveDescription,
        confirm: t.value.removeMemberConfirm
      }
})
function changeMember(userId: string, name: string, next: RoomMemberRole | 'owner' | 'remove') {
  if (next === 'remove') confirming.value = { kind: 'remove', userId, name }
  else if (next === 'owner') confirming.value = { kind: 'transfer', userId, name }
  else emit('changeRole', userId, next)
}
function confirm() {
  const pending = confirming.value
  confirming.value = null
  if (pending?.kind === 'transfer') emit('transfer', pending.userId)
  else if (pending) emit('remove', pending.userId)
}
function invite() {
  const address = email.value.trim()
  if (!address) return
  emit('invite', address, role.value)
  email.value = ''
}

const AUDIT_TEXT = {
  'room-created': 'roomsAuditRoomCreated',
  'member-invited': 'roomsAuditMemberInvited',
  'invitation-revoked': 'roomsAuditInvitationRevoked',
  'invitation-accepted': 'roomsAuditInvitationAccepted',
  'role-changed': 'roomsAuditRoleChanged',
  'member-removed': 'roomsAuditMemberRemoved',
  'member-left': 'roomsAuditMemberLeft',
  'ownership-transferred': 'roomsAuditOwnershipTransferred',
  'access-changed': 'roomsAuditAccessChanged',
  'room-moved': 'roomsAuditRoomMoved',
  'room-archived': 'roomsAuditRoomArchived',
  'room-restored': 'roomsAuditRoomRestored'
} as const satisfies Record<RoomAuditAction, string>
const nameOf = computed(
  () => new Map((members?.members ?? []).map((member) => [member.userId, member.name]))
)
const events = computed(() =>
  (audit?.events ?? []).map((event) => ({
    id: event.id,
    text: t.value[AUDIT_TEXT[event.action]]({
      actor: event.actor.name ?? t.value.roomsSomeone,
      subject:
        (event.subjectUserId ? nameOf.value.get(event.subjectUserId) : undefined) ??
        event.subjectEmail ??
        t.value.roomsSomeone
    }),
    date: dates.format(event.createdAt, 'dateTime')
  }))
)
</script>

<template>
  <AppDialogRoot v-model:open="open" size="md">
    <AppDialogHeader
      :heading="shown?.name ?? ''"
      :description="t.roomsAccess"
      :close-label="common.close"
    />
    <AppDialogBody>
      <div :class="ui.stack()">
        <AppAlert v-if="failure" tone="error" :heading="failure" />
        <AppTabsRoot v-model="tab">
          <AppTabsList :label="t.membersSections">
            <AppTabsTrigger value="members">
              {{ t.membersTab }}
              <template v-if="members" #trailing>
                <span class="text-muted tabular-nums">{{ members.members.length }}</span>
              </template>
            </AppTabsTrigger>
            <AppTabsTrigger v-if="isOwner" value="invited">
              {{ t.invitedTab }}
              <template v-if="members?.invitations.length" #trailing>
                <span class="text-muted tabular-nums">{{ members.invitations.length }}</span>
              </template>
            </AppTabsTrigger>
            <AppTabsTrigger v-if="isOwner" value="activity">{{ t.roomsActivity }}</AppTabsTrigger>
          </AppTabsList>

          <AppTabsContent value="members" :class="[ui.stack(), 'pt-4']">
            <section v-if="isOwner" :class="ui.section()">
              <h3 :class="ui.sectionTitle()">{{ t.roomsAccess }}</h3>
              <AppCheckboxCard
                v-if="shown?.parentId"
                v-model="restricted"
                :disabled="busy"
                :label="t.roomsAccessRestricted"
                :description="
                  restricted ? t.roomsAccessRestrictedDescription : t.roomsAccessInheritDescription
                "
                data-test-id="room-access-restricted"
              />
              <p v-else :class="ui.note()">{{ t.roomsAccessTopLevel }}</p>
            </section>

            <section v-if="isOwner" :class="ui.section()">
              <h3 :class="ui.sectionTitle()">{{ t.invitePeople }}</h3>
              <form :class="ui.inline()" novalidate @submit.prevent="invite">
                <label for="cloud-room-invite" class="sr-only">{{ t.inviteEmail }}</label>
                <AppInput
                  id="cloud-room-invite"
                  v-model="email"
                  type="email"
                  autocomplete="off"
                  :placeholder="t.inviteEmailPlaceholder"
                  :disabled="busy"
                  :ui="{ root: 'flex-1' }"
                />
                <AppSelect
                  v-model="role"
                  :label="t.inviteRole"
                  :options="roleOptions"
                  size="sm"
                  :ui="{ trigger: ui.roleSelect(), item: ui.roleItem() }"
                >
                  <template #option="{ option }">
                    <span class="flex flex-col">
                      <span>{{ option.label }}</span>
                      <span class="text-[11px] text-muted">{{
                        roleDescriptions[option.value]
                      }}</span>
                    </span>
                  </template>
                </AppSelect>
                <AppButton type="submit" variant="outline" :disabled="busy || !email.trim()">
                  {{ t.invite }}
                </AppButton>
              </form>
              <div v-if="invitationLink" :class="ui.sent()">
                <p :class="ui.note()">{{ t.invitationSentNote }}</p>
                <AppButton
                  class="self-start"
                  size="sm"
                  variant="outline"
                  @click="copy(invitationLink)"
                >
                  <template #leading>
                    <icon-lucide-check v-if="copied" class="size-3.5" />
                    <icon-lucide-link v-else class="size-3.5" />
                  </template>
                  {{ copied ? common.copied : t.copyInvitationLink }}
                </AppButton>
              </div>
            </section>

            <section :class="ui.section()">
              <p v-if="!members" :class="ui.note()" role="status">{{ t.membersLoading }}</p>
              <ul v-else :class="ui.list()">
                <li v-for="member in members.members" :key="member.userId" :class="ui.row()">
                  <AccountAvatar :id="member.userId" :name="member.name" :image="member.image" />
                  <span :class="ui.person()">
                    <span :class="ui.personName()">
                      {{ member.name }}
                      <span v-if="member.userId === self" :class="ui.you()">{{ common.you }}</span>
                    </span>
                    <span :class="ui.personEmail()">
                      {{ member.email }}
                      <template v-if="member.source === 'inherited'">
                        · {{ t.roomsInherited }}</template
                      >
                    </span>
                  </span>
                  <AppSelect
                    v-if="isOwner && member.source === 'direct' && member.role !== 'owner'"
                    :model-value="member.role"
                    :label="t.roomsMemberActions({ name: member.name })"
                    :options="memberOptions"
                    :disabled="busy"
                    :ui="{ trigger: ui.roleSelect() }"
                    @update:model-value="(next) => changeMember(member.userId, member.name, next)"
                  />
                  <span v-else :class="ui.role()">{{ roleLabels[member.role] }}</span>
                </li>
              </ul>
            </section>
          </AppTabsContent>

          <AppTabsContent v-if="isOwner" value="invited" :class="[ui.stack(), 'pt-4']">
            <ul v-if="members?.invitations.length" :class="ui.list()">
              <li v-for="invitation in members.invitations" :key="invitation.id" :class="ui.row()">
                <span :class="ui.pendingIcon()"><icon-lucide-mail class="size-3.5" /></span>
                <span :class="ui.person()">
                  <span :class="ui.personName()">{{ invitation.email }}</span>
                  <span :class="ui.personDetail()">{{
                    t.shareInvitationExpires({ date: dates.format(invitation.expiresAt, 'day') })
                  }}</span>
                </span>
                <span :class="ui.role()">{{ roleLabels[invitation.role] }}</span>
                <AppButton
                  size="xs"
                  variant="link"
                  :disabled="busy"
                  @click="emit('revoke', invitation.id)"
                >
                  {{ t.revokeInvitation }}
                </AppButton>
              </li>
            </ul>
            <AppPlaceholder
              v-else
              size="compact"
              :fill="false"
              :label="t.noInvitations"
              :description="t.noInvitationsDescription"
            >
              <template #icon><icon-lucide-mail class="size-5" /></template>
            </AppPlaceholder>
          </AppTabsContent>

          <AppTabsContent v-if="isOwner" value="activity" :class="[ui.stack(), 'pt-4']">
            <ul v-if="events.length" :class="rooms.activity()">
              <li v-for="event in events" :key="event.id" :class="rooms.activityRow()">
                <span :class="rooms.activityText()">{{ event.text }}</span>
                <span :class="rooms.activityDate()">{{ event.date }}</span>
              </li>
            </ul>
            <p v-else :class="ui.note()">{{ t.roomsActivityEmpty }}</p>
          </AppTabsContent>
        </AppTabsRoot>
      </div>
    </AppDialogBody>
    <AppDialogFooter>
      <AppButton color="primary" variant="solid" @click="open = false">{{ common.done }}</AppButton>
    </AppDialogFooter>
  </AppDialogRoot>
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
</template>
