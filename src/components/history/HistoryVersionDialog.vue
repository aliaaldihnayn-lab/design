<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { useCommonMessages, useHistoryMessages } from '@lawha/vue/i18n'

import { historyVersionDialog } from '@/app/history/dialog'
import AppButton from '@/components/ui/button/AppButton.vue'
import AppDialogBody from '@/components/ui/dialog/AppDialogBody.vue'
import AppDialogFooter from '@/components/ui/dialog/AppDialogFooter.vue'
import AppDialogHeader from '@/components/ui/dialog/AppDialogHeader.vue'
import AppDialogRoot from '@/components/ui/dialog/AppDialogRoot.vue'
import AppAlert from '@/components/ui/feedback/AppAlert.vue'
import AppInput from '@/components/ui/input/AppInput.vue'
import AppTextarea from '@/components/ui/input/AppTextarea.vue'
import { useHeldContent } from '@/components/ui/overlay/held'

import { historyPanel } from './ui'

/** Save version, with a title and what changed, or Edit version info for a version kept. */
const t = useHistoryMessages()
const common = useCommonMessages()
const ui = historyPanel()
const title = ref('')
const description = ref('')
const busy = ref(false)
const failed = ref(false)

const open = computed({
  get: () => historyVersionDialog.value !== null,
  set: (value) => {
    if (!value) historyVersionDialog.value = null
  }
})
const shown = useHeldContent(historyVersionDialog)
const editing = computed(() => shown.value?.version ?? null)
const trimmed = computed(() => title.value.trim())

watch(historyVersionDialog, (dialog) => {
  if (!dialog) return
  title.value = dialog.version?.title ?? ''
  description.value = dialog.version?.description ?? ''
  failed.value = false
})

async function submit() {
  const dialog = historyVersionDialog.value
  if (!dialog || !trimmed.value) return
  busy.value = true
  failed.value = false
  try {
    await dialog.save({ title: trimmed.value, description: description.value.trim() })
    historyVersionDialog.value = null
  } catch (error) {
    console.warn('[History] Saving the version failed:', error)
    failed.value = true
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <AppDialogRoot v-model:open="open" size="sm">
    <AppDialogHeader
      :heading="editing ? t.editVersionInfo : t.saveVersionHeading"
      :close-label="common.close"
    />
    <AppDialogBody>
      <form id="history-version" :class="ui.form()" novalidate @submit.prevent="submit">
        <label for="history-version-title" :class="ui.label()">{{ t.versionTitle }}</label>
        <AppInput
          id="history-version-title"
          v-model="title"
          autofocus
          :maxlength="100"
          :disabled="busy"
          :placeholder="t.versionTitle"
        />
        <label for="history-version-description" :class="ui.label()">
          {{ t.versionDescription }}
        </label>
        <AppTextarea
          id="history-version-description"
          v-model="description"
          :maxlength="1000"
          :disabled="busy"
          :placeholder="t.versionDescription"
        />
        <AppAlert v-if="failed" tone="error" :heading="t.changeFailed" />
      </form>
    </AppDialogBody>
    <AppDialogFooter>
      <AppButton @click="open = false">{{ common.cancel }}</AppButton>
      <AppButton
        type="submit"
        form="history-version"
        color="primary"
        variant="solid"
        :loading="busy"
        :disabled="!trimmed"
      >
        {{ common.save }}
      </AppButton>
    </AppDialogFooter>
  </AppDialogRoot>
</template>
