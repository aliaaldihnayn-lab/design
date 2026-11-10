<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { encryptPDF } from '@lawha/core/pdf-sign'
import { encryptDocx, writeDocx } from '@lawha/core/writer'
import { useWriterMessages } from '@lawha/vue/i18n'

import { DOCX, PDF, pickFile, saveFileAs } from '@/app/writer/files'
import { writerDocument, writerName } from '@/app/writer/session'
import AppButton from '@/components/ui/button/AppButton.vue'
import { AppDialog } from '@/components/ui/dialog'
import AppAlert from '@/components/ui/feedback/AppAlert.vue'
import AppInput from '@/components/ui/input/AppInput.vue'

import { writer } from './ui'

/** Saves the document as a password-protected Word file, or encrypts a PDF. */
const open = defineModel<boolean>('open', { default: false })
const t = useWriterMessages()
const ui = writer()

const password = ref('')
const confirm = ref('')
const busy = ref(false)
const error = ref<string | null>(null)
const done = ref(false)
const ready = computed(() => password.value.length > 0 && password.value === confirm.value)

watch(open, (isOpen) => {
  if (!isOpen) return
  password.value = ''
  confirm.value = ''
  error.value = null
  done.value = false
})

async function run(action: () => Promise<boolean>) {
  if (password.value !== confirm.value) {
    error.value = t.value.passwordsDiffer
    return
  }
  busy.value = true
  error.value = null
  try {
    done.value = await action()
  } catch (failure) {
    error.value = t.value.saveFailed({
      error: failure instanceof Error ? failure.message : String(failure)
    })
  } finally {
    busy.value = false
  }
}

async function saveDocx(): Promise<boolean> {
  const bytes = encryptDocx(writeDocx(writerDocument.value), password.value)
  return (await saveFileAs(bytes, writerName.value || 'Document', DOCX)) !== null
}

async function savePDF(): Promise<boolean> {
  const file = await pickFile(PDF)
  if (!file) return false
  const bytes = await encryptPDF(file.bytes, password.value)
  return (await saveFileAs(bytes, file.name.replace(/\.pdf$/i, '-protected'), PDF)) !== null
}
</script>

<template>
  <AppDialog
    v-model:open="open"
    size="sm"
    :heading="t.passwordProtection"
    :close-label="t.cancel"
    data-test-id="writer-protect-dialog"
  >
    <div :class="ui.form()">
      <AppInput
        v-model="password"
        type="password"
        autocomplete="new-password"
        :aria-label="t.password"
        :placeholder="t.password"
        data-test-id="writer-protect-password"
      />
      <AppInput
        v-model="confirm"
        type="password"
        autocomplete="new-password"
        :aria-label="t.confirmPassword"
        :placeholder="t.confirmPassword"
        data-test-id="writer-protect-confirm"
      />
      <AppAlert v-if="error" tone="error" :heading="error" />
      <AppAlert v-if="done" tone="success" :heading="t.saved" />
    </div>
    <template #footer>
      <AppButton size="sm" variant="outline" :disabled="busy || !ready" @click="run(savePDF)">{{
        t.saveEncryptedPDF
      }}</AppButton>
      <AppButton
        size="sm"
        :disabled="busy || !ready"
        data-test-id="writer-protect-docx"
        @click="run(saveDocx)"
        >{{ t.saveEncryptedDocx }}</AppButton
      >
    </template>
  </AppDialog>
</template>
