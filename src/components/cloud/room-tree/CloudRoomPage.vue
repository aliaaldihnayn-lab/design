<script setup lang="ts">
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from 'reka-ui'
import { computed } from 'vue'

import type { CloudDocumentKind, RoomDetail, RoomFile, RoomPresence } from '@lawha/cloud/contract'
import { useCloudMessages, useCommonMessages } from '@lawha/vue/i18n'

import { useDateFormat } from '@/app/i18n/date'
import { DOCUMENT_KIND_ICONS, STORED_DOCUMENT_KIND_ICONS } from '@/components/home/document/kinds'
import AccountAvatar from '@/components/presence/AccountAvatar.vue'
import AppButton from '@/components/ui/button/AppButton.vue'
import IconButton from '@/components/ui/button/IconButton.vue'
import AppAlert from '@/components/ui/feedback/AppAlert.vue'
import AppBadge from '@/components/ui/feedback/AppBadge.vue'
import AppPlaceholder from '@/components/ui/feedback/AppPlaceholder.vue'
import AppSkeleton from '@/components/ui/feedback/AppSkeleton.vue'
import { menu } from '@/components/ui/menu/menu'
import Tip from '@/components/ui/overlay/Tip.vue'

import { cloudRooms } from './ui'

/**
 * One room: where it sits among the rooms the person can enter, who is in it now, its sub-rooms
 * and files, and what the person's role lets them do here.
 */
const {
  detail = null,
  state,
  people = [],
  failure = null,
  busy = false,
  compact = false,
  query = ''
} = defineProps<{
  detail?: RoomDetail | null
  state: 'idle' | 'loading' | 'ready' | 'no-access' | 'error'
  people?: RoomPresence['people']
  /** Why the last change was refused, already worded. */
  failure?: string | null
  busy?: boolean
  /** On a narrow screen, the page offers a way back to the tree. */
  compact?: boolean
  /** Home's search, already lowercased in the app's locale. */
  query?: string
}>()
const emit = defineEmits<{
  select: [roomId: string]
  back: []
  retry: []
  members: []
  newSubRoom: []
  newFile: [kind: CloudDocumentKind]
  rename: []
  move: []
  archive: [archived: boolean]
  leave: []
  openFile: [file: RoomFile]
  moveFile: [file: RoomFile]
  removeFile: [file: RoomFile]
}>()

const ui = cloudRooms()
const menuUI = menu()
const t = useCloudMessages()
const common = useCommonMessages()
const dates = useDateFormat()
const room = computed(() => detail?.room ?? null)
const canEdit = computed(() => room.value?.role === 'owner' || room.value?.role === 'editor')
const isOwner = computed(() => room.value?.role === 'owner')
const roleLabel = computed(() => {
  const role = room.value?.role
  if (role === 'owner') return t.value.roomsRoleOwner
  return role === 'editor' ? t.value.roleEditor : t.value.roleViewer
})
const files = computed(() =>
  (detail?.files ?? []).filter(
    (file) => !query || file.document.name.toLocaleLowerCase().includes(query)
  )
)
const children = computed(() =>
  (detail?.children ?? []).filter(
    (child) => !query || child.name.toLocaleLowerCase().includes(query)
  )
)
const empty = computed(
  () => detail !== null && detail.files.length === 0 && detail.children.length === 0
)
</script>

<template>
  <section :class="ui.page()" data-test-id="room-page">
    <AppButton v-if="compact" class="self-start" size="sm" variant="ghost" @click="emit('back')">
      <template #leading><icon-lucide-arrow-left class="size-3.5 rtl:rotate-180" /></template>
      {{ t.roomsBack }}
    </AppButton>

    <AppPlaceholder
      v-if="state === 'idle'"
      size="compact"
      :fill="false"
      :label="t.roomsPick"
      :description="t.roomsPickDescription"
    >
      <template #icon><icon-lucide-door-open class="size-5" /></template>
    </AppPlaceholder>

    <div v-else-if="state === 'loading'" class="flex flex-col gap-3">
      <AppSkeleton class="h-5 w-48" />
      <AppSkeleton class="h-10 w-full" />
      <AppSkeleton class="h-10 w-full" />
    </div>

    <AppPlaceholder
      v-else-if="state === 'no-access'"
      size="compact"
      :fill="false"
      :label="t.roomsNoAccess"
      :description="t.roomsNoAccessDescription"
      data-test-id="room-no-access"
    >
      <template #icon><icon-lucide-lock class="size-5" /></template>
    </AppPlaceholder>

    <AppAlert
      v-else-if="state === 'error' || !room"
      tone="error"
      :heading="t.roomsLoadFailed"
      :description="t.roomsLoadFailedDescription"
    >
      <template #actions>
        <AppButton size="sm" variant="outline" @click="emit('retry')">{{ t.tryAgain }}</AppButton>
      </template>
    </AppAlert>

    <template v-else>
      <header :class="ui.header()">
        <div :class="ui.heading()">
          <nav v-if="detail?.path.length" :class="ui.breadcrumbs()" :aria-label="t.roomsPath">
            <template v-for="crumb in detail.path" :key="crumb.id">
              <button type="button" :class="ui.crumb()" @click="emit('select', crumb.id)">
                {{ crumb.name }}
              </button>
              <icon-lucide-chevron-right
                class="size-3 shrink-0 rtl:rotate-180"
                aria-hidden="true"
              />
            </template>
          </nav>
          <h2 :class="ui.title()">
            <span class="truncate">{{ room.name }}</span>
            <Tip
              v-if="room.accessMode === 'restricted' && room.parentId"
              :label="t.roomsRestricted"
            >
              <icon-lucide-lock
                class="size-3.5 text-muted"
                role="img"
                :aria-label="t.roomsRestricted"
              />
            </Tip>
            <AppBadge v-if="room.archivedAt">{{ t.roomsArchived }}</AppBadge>
          </h2>
          <span class="text-[11px] text-muted">{{ roleLabel }}</span>
        </div>
        <div :class="ui.actions()">
          <div v-if="people.length" :class="ui.presence()" role="list" :aria-label="t.roomsHereNow">
            <Tip v-for="person in people" :key="person.userId" :label="person.name">
              <span role="listitem">
                <AccountAvatar
                  :id="person.userId"
                  :name="person.name"
                  :image="person.image"
                  size="sm"
                />
              </span>
            </Tip>
          </div>
          <AppButton
            size="sm"
            variant="outline"
            data-test-id="room-members"
            @click="emit('members')"
          >
            <template #leading><icon-lucide-users class="size-3.5" /></template>
            {{ t.roomsMembers }}
          </AppButton>
          <DropdownMenuRoot v-if="canEdit" :modal="false">
            <DropdownMenuTrigger as-child>
              <AppButton size="sm" variant="outline" :disabled="busy" data-test-id="room-new">
                <template #leading><icon-lucide-plus class="size-3.5" /></template>
                {{ t.roomsNew }}
              </AppButton>
            </DropdownMenuTrigger>
            <DropdownMenuPortal>
              <DropdownMenuContent align="end" :side-offset="4" :class="[menuUI.content(), 'w-48']">
                <DropdownMenuItem
                  :class="menuUI.item({ justify: 'start' })"
                  @select="emit('newFile', 'design')"
                >
                  <component :is="DOCUMENT_KIND_ICONS.design" :class="menuUI.icon()" />
                  {{ t.roomsNewDesign }}
                </DropdownMenuItem>
                <DropdownMenuItem
                  :class="menuUI.item({ justify: 'start' })"
                  @select="emit('newFile', 'board')"
                >
                  <component :is="DOCUMENT_KIND_ICONS.board" :class="menuUI.icon()" />
                  {{ t.roomsNewBoard }}
                </DropdownMenuItem>
                <DropdownMenuItem
                  :class="menuUI.item({ justify: 'start' })"
                  data-test-id="room-new-text"
                  @select="emit('newFile', 'writer')"
                >
                  <component :is="STORED_DOCUMENT_KIND_ICONS.writer" :class="menuUI.icon()" />
                  {{ t.roomsNewText }}
                </DropdownMenuItem>
                <DropdownMenuSeparator :class="menuUI.separator()" />
                <DropdownMenuItem
                  :class="menuUI.item({ justify: 'start' })"
                  @select="emit('newSubRoom')"
                >
                  <icon-lucide-door-open :class="menuUI.icon()" />
                  {{ t.roomsNewSubRoom }}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenuPortal>
          </DropdownMenuRoot>
          <DropdownMenuRoot :modal="false">
            <DropdownMenuTrigger as-child>
              <IconButton :label="t.roomsMore" :disabled="busy">
                <icon-lucide-ellipsis class="size-3.5" />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuPortal>
              <DropdownMenuContent align="end" :side-offset="4" :class="[menuUI.content(), 'w-48']">
                <DropdownMenuItem
                  v-if="canEdit"
                  :class="menuUI.item({ justify: 'start' })"
                  @select="emit('rename')"
                >
                  <icon-lucide-pencil :class="menuUI.icon()" />
                  {{ t.roomsRename }}
                </DropdownMenuItem>
                <DropdownMenuItem
                  v-if="isOwner"
                  :class="menuUI.item({ justify: 'start' })"
                  @select="emit('move')"
                >
                  <icon-lucide-folder-input :class="menuUI.icon()" />
                  {{ t.roomsMove }}
                </DropdownMenuItem>
                <DropdownMenuItem
                  v-if="isOwner"
                  :class="menuUI.item({ justify: 'start' })"
                  @select="emit('archive', room.archivedAt === null)"
                >
                  <icon-lucide-archive :class="menuUI.icon()" />
                  {{ room.archivedAt ? t.roomsRestore : t.roomsArchive }}
                </DropdownMenuItem>
                <DropdownMenuSeparator v-if="canEdit && !isOwner" :class="menuUI.separator()" />
                <DropdownMenuItem
                  v-if="!isOwner"
                  :class="menuUI.item({ justify: 'start' })"
                  @select="emit('leave')"
                >
                  <icon-lucide-log-out :class="menuUI.icon()" />
                  {{ t.roomsLeave }}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenuPortal>
          </DropdownMenuRoot>
        </div>
      </header>

      <AppAlert v-if="failure" tone="error" :heading="failure" />

      <AppPlaceholder
        v-if="empty"
        size="compact"
        :fill="false"
        :label="t.roomsEmptyRoom"
        :description="t.roomsEmptyRoomDescription"
      >
        <template #icon><icon-lucide-inbox class="size-5" /></template>
        <template v-if="canEdit" #action>
          <AppButton size="sm" variant="outline" @click="emit('newFile', 'design')">
            {{ t.roomsNewDesign }}
          </AppButton>
        </template>
      </AppPlaceholder>

      <section v-if="children.length" :class="ui.section()">
        <h3 :class="ui.sectionTitle()">{{ t.roomsSubRooms }}</h3>
        <div :class="ui.grid()">
          <button
            v-for="child in children"
            :key="child.id"
            type="button"
            :class="ui.card()"
            @click="emit('select', child.id)"
          >
            <icon-lucide-door-open class="size-4 shrink-0 text-muted" />
            <span :class="ui.cardLabel()">{{ child.name }}</span>
            <icon-lucide-lock
              v-if="child.accessMode === 'restricted'"
              class="size-3.5 shrink-0 text-muted"
              role="img"
              :aria-label="t.roomsRestricted"
            />
            <span class="shrink-0 text-[11px] text-muted tabular-nums">{{ child.fileCount }}</span>
          </button>
        </div>
      </section>

      <section v-if="files.length" :class="ui.section()">
        <h3 :class="ui.sectionTitle()">{{ t.roomsFiles }}</h3>
        <ul :class="ui.list()">
          <li v-for="file in files" :key="file.document.id" :class="ui.file()">
            <button type="button" :class="ui.fileOpen()" @click="emit('openFile', file)">
              <component
                :is="STORED_DOCUMENT_KIND_ICONS[file.document.kind]"
                class="size-4 shrink-0 text-muted"
              />
              <span :class="ui.fileName()">{{ file.document.name }}</span>
              <span :class="ui.fileMeta()">{{ dates.relative(file.document.updatedAt) }}</span>
            </button>
            <DropdownMenuRoot v-if="canEdit" :modal="false">
              <DropdownMenuTrigger as-child>
                <IconButton
                  :label="t.roomsFileActions({ name: file.document.name })"
                  :disabled="busy"
                >
                  <icon-lucide-ellipsis class="size-3.5" />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuPortal>
                <DropdownMenuContent
                  align="end"
                  :side-offset="4"
                  :class="[menuUI.content(), 'w-52']"
                >
                  <DropdownMenuItem
                    :class="menuUI.item({ justify: 'start' })"
                    @select="emit('moveFile', file)"
                  >
                    <icon-lucide-folder-input :class="menuUI.icon()" />
                    {{ t.roomsMoveFile }}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    :class="menuUI.item({ justify: 'start' })"
                    @select="emit('removeFile', file)"
                  >
                    <icon-lucide-folder-minus :class="menuUI.icon()" />
                    {{ t.roomsRemoveFile }}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenuPortal>
            </DropdownMenuRoot>
          </li>
        </ul>
      </section>
      <p v-if="!empty && query && !files.length && !children.length" class="text-xs text-muted">
        {{ common.noResults }}
      </p>
    </template>
  </section>
</template>
