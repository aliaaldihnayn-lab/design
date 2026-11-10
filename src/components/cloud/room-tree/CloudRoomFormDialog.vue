<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import type { RoomAccessMode } from '@lawha/cloud/contract'
import { useCloudMessages, useCommonMessages } from '@lawha/vue/i18n'

import AppButton from '@/components/ui/button/AppButton.vue'
import AppDialogBody from '@/components/ui/dialog/AppDialogBody.vue'
import AppDialogFooter from '@/components/ui/dialog/AppDialogFooter.vue'
import AppDialogHeader from '@/components/ui/dialog/AppDialogHeader.vue'
import AppDialogRoot from '@/components/ui/dialog/AppDialogRoot.vue'
import AppAlert from '@/components/ui/feedback/AppAlert.vue'
import AppInput from '@/components/ui/input/AppInput.vue'
import { useHeldContent } from '@/components/ui/overlay/held'
import AppSelect from '@/components/ui/select/AppSelect.vue'
import AppCheckboxCard from '@/components/ui/toggle/AppCheckboxCard.vue'

import { cloudWorkspace } from '../workspace/ui'

/** What the form makes: a top-level room in a workspace, a sub-room, or a new name for a room. */
export type CloudRoomForm =
  | { kind: 'create'; workspaces: { id: string; name: string }[] }
  | { kind: 'create-sub'; parentName: string }
  | { kind: 'rename'; name: string }

const {
  form = null,
  busy = false,
  failure = null
} = defineProps<{
  form?: CloudRoomForm | null
  busy?: boolean
  failure?: string | null
}>()
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{
  submit: [input: { name: string; workspaceId?: string; accessMode?: RoomAccessMode }]
}>()

const ui = cloudWorkspace()
const t = useCloudMessages()
const common = useCommonMessages()
const shown = useHeldContent(() => form, open)
const name = ref('')
const workspaceId = ref('')
const restricted = ref(false)
watch(open, (isOpen) => {
  if (!isOpen || !form) return
  name.value = form.kind === 'rename' ? form.name : ''
  workspaceId.value = form.kind === 'create' ? (form.workspaces[0]?.id ?? '') : ''
  restricted.value = false
})
const heading = computed(() => {
  const current = shown.value
  if (current?.kind === 'rename') return t.value.roomsRenameHeading
  return current?.kind === 'create-sub' ? t.value.roomsNewSubRoom : t.value.roomsNew
})
const workspaceOptions = computed(() =>
  shown.value?.kind === 'create'
    ? shown.value.workspaces.map((workspace) => ({ value: workspace.id, label: workspace.name }))
    : []
)
const ready = computed(
  () => name.value.trim().length > 0 && (shown.value?.kind !== 'create' || workspaceId.value)
)
function submit() {
  const current = shown.value
  if (!ready.value || !current) return
  if (current.kind === 'create')
    emit('submit', { name: name.value.trim(), workspaceId: workspaceId.value })
  else if (current.kind === 'create-sub') {
    emit('submit', {
      name: name.value.trim(),
      accessMode: restricted.value ? 'restricted' : 'inherit'
    })
  } else emit('submit', { name: name.value.trim() })
}
</script>

<template>
  <AppDialogRoot v-model:open="open" size="sm">
    <AppDialogHeader
      :heading="heading"
      :description="shown?.kind === 'create-sub' ? shown.parentName : undefined"
      :close-label="common.close"
    />
    <AppDialogBody>
      <form id="cloud-room-form" :class="ui.stack()" novalidate @submit.prevent="submit">
        <AppAlert v-if="failure" tone="error" :heading="failure" />
        <div :class="ui.form()">
          <label for="cloud-room-name" :class="ui.label()">{{ t.roomsName }}</label>
          <AppInput
            id="cloud-room-name"
            v-model="name"
            maxlength="100"
            autocomplete="off"
            :disabled="busy"
            data-test-id="room-name"
          />
        </div>
        <div v-if="shown?.kind === 'create' && workspaceOptions.length > 1" :class="ui.form()">
          <span :class="ui.label()">{{ t.roomsWorkspace }}</span>
          <AppSelect
            v-model="workspaceId"
            :label="t.roomsWorkspace"
            :options="workspaceOptions"
            size="sm"
          />
        </div>
        <p v-if="shown?.kind === 'create'" :class="ui.note()">{{ t.roomsAccessTopLevel }}</p>
        <AppCheckboxCard
          v-if="shown?.kind === 'create-sub'"
          v-model="restricted"
          :label="t.roomsAccessRestricted"
          :description="
            restricted ? t.roomsAccessRestrictedDescription : t.roomsAccessInheritDescription
          "
        />
      </form>
    </AppDialogBody>
    <AppDialogFooter>
      <AppButton variant="ghost" @click="open = false">{{ common.cancel }}</AppButton>
      <AppButton
        type="submit"
        form="cloud-room-form"
        color="primary"
        variant="solid"
        :disabled="!ready"
        :loading="busy"
        data-test-id="room-form-submit"
      >
        {{ shown?.kind === 'rename' ? t.roomsSave : t.roomsCreate }}
      </AppButton>
    </AppDialogFooter>
  </AppDialogRoot>
</template>
