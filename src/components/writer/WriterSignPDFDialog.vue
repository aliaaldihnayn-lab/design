<script setup lang="ts">
import { compact } from 'es-toolkit'
import { computed, ref, watch } from 'vue'

import { pdfPageSizes } from '@lawha/core/pdf-sign'
import { useWriterMessages } from '@lawha/vue/i18n'

import { useDateFormat } from '@/app/i18n/date'
import { PDF, pickFile, saveFileAs, type PickedFile } from '@/app/writer/files'
import { writerAuthor } from '@/app/writer/session'
import {
  createSigningCertificate,
  importSigningCertificate,
  removeSigningCertificate,
  signatureStamp,
  signingCertificate,
  signWithCertificate,
  type SigningOutcome
} from '@/app/writer/signing'
import AppButton from '@/components/ui/button/AppButton.vue'
import { AppDialog } from '@/components/ui/dialog'
import AppAlert from '@/components/ui/feedback/AppAlert.vue'
import AppInput from '@/components/ui/input/AppInput.vue'
import AppSelect from '@/components/ui/select/AppSelect.vue'

import { writer } from './ui'

/** Digitally signs a PDF with the person's certificate, made here or imported. */
const open = defineModel<boolean>('open', { default: false })
const t = useWriterMessages()
const dates = useDateFormat()
const ui = writer()

const certificate = ref(signingCertificate())
const certName = ref('')
const certEmail = ref('')
const certPassword = ref('')
const certConfirm = ref('')
const importFile = ref<PickedFile | null>(null)

const pdf = ref<PickedFile | null>(null)
const password = ref('')
const reason = ref('')
const location = ref('')
const placement = ref<'none' | 'bottom-end' | 'bottom-start'>('bottom-end')
const busy = ref(false)
const error = ref<string | null>(null)
const done = ref(false)

const placementOptions = computed(() => [
  { value: 'bottom-end', label: t.value.stampBottomRight },
  { value: 'bottom-start', label: t.value.stampBottomLeft },
  { value: 'none', label: t.value.stampHidden }
])

watch(open, (isOpen) => {
  if (!isOpen) return
  certificate.value = signingCertificate()
  certName.value = writerAuthor.value
  password.value = ''
  error.value = null
  done.value = false
})

function report(outcome: SigningOutcome): boolean {
  if (outcome.status === 'done') {
    error.value = null
    certificate.value = signingCertificate()
    return true
  }
  if (outcome.reason === 'wrong-password') error.value = t.value.wrongPassword
  else if (outcome.reason === 'no-certificate') error.value = t.value.noCertificate
  else error.value = t.value.signFailed({ error: outcome.detail })
  return false
}

async function create() {
  if (certPassword.value !== certConfirm.value) {
    error.value = t.value.passwordsDiffer
    return
  }
  busy.value = true
  report(
    await createSigningCertificate(
      certName.value.trim(),
      certEmail.value.trim(),
      certPassword.value
    )
  )
  busy.value = false
}

async function chooseCertificate() {
  importFile.value = await pickFile({
    description: 'PKCS #12',
    mime: 'application/x-pkcs12',
    extension: 'p12'
  })
}

async function importCertificate() {
  if (!importFile.value) return
  busy.value = true
  report(await importSigningCertificate(importFile.value.bytes, certPassword.value))
  busy.value = false
}

async function forget() {
  await removeSigningCertificate()
  certificate.value = null
}

async function choosePDF() {
  pdf.value = await pickFile(PDF)
  done.value = false
}

const STAMP_WIDTH = 180
const STAMP_HEIGHT = 60
const MARGIN = 36

async function sign() {
  const file = pdf.value
  if (!file || !certificate.value) return
  busy.value = true
  error.value = null
  try {
    const date = new Date()
    let appearance
    if (placement.value !== 'none') {
      const sizes = await pdfPageSizes(file.bytes)
      const last = sizes.at(-1) ?? { width: 595, height: 842 }
      const x = placement.value === 'bottom-end' ? last.width - MARGIN - STAMP_WIDTH : MARGIN
      const lines = [
        certificate.value.subject,
        dates.format(date.toISOString(), 'dateTime'),
        reason.value
      ]
      const png = await signatureStamp(compact(lines), null)
      appearance = {
        page: sizes.length - 1,
        rect: [x, MARGIN, STAMP_WIDTH, STAMP_HEIGHT] as [number, number, number, number],
        png
      }
    }
    const result = await signWithCertificate(file.bytes, password.value, {
      name: certificate.value.subject,
      reason: reason.value || undefined,
      location: location.value || undefined,
      date,
      appearance
    })
    if ('bytes' in result) {
      const name = file.name.replace(/\.pdf$/i, '')
      const saved = await saveFileAs(result.bytes, `${name}-signed.pdf`, PDF)
      done.value = saved !== null
    } else report(result)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <AppDialog
    v-model:open="open"
    size="md"
    :heading="t.signPDF"
    :description="t.digitalSignatureDescription"
    :close-label="t.cancel"
    data-test-id="writer-sign-pdf-dialog"
  >
    <div :class="ui.form()">
      <section class="flex flex-col gap-2">
        <h3 class="font-semibold">{{ t.certificate }}</h3>
        <div v-if="certificate" :class="ui.card()" data-test-id="writer-certificate">
          <span class="font-semibold text-surface">{{ certificate.subject }}</span>
          <span class="text-muted"
            >{{ certificate.issuer }} · {{ dates.format(certificate.notAfter, 'date') }}</span
          >
          <p v-if="certificate.selfSigned" class="text-muted">{{ t.selfSignedNote }}</p>
          <AppButton size="xs" variant="ghost" class="self-end" @click="forget">{{
            t.removeCertificate
          }}</AppButton>
        </div>
        <template v-else>
          <p class="text-muted">{{ t.noCertificate }}</p>
          <div :class="ui.formGrid()">
            <AppInput
              v-model="certName"
              :aria-label="t.signerName"
              :placeholder="t.signerName"
              data-test-id="writer-cert-name"
            />
            <AppInput
              v-model="certEmail"
              type="email"
              :aria-label="t.signerEmail"
              :placeholder="t.signerEmail"
            />
            <AppInput
              v-model="certPassword"
              type="password"
              autocomplete="new-password"
              :aria-label="t.certificatePassword"
              :placeholder="t.certificatePassword"
              data-test-id="writer-cert-password"
            />
            <AppInput
              v-model="certConfirm"
              type="password"
              autocomplete="new-password"
              :aria-label="t.confirmPassword"
              :placeholder="t.confirmPassword"
              data-test-id="writer-cert-confirm"
            />
          </div>
          <div class="flex flex-wrap gap-1.5">
            <AppButton
              size="sm"
              :disabled="busy || !certName.trim() || !certPassword"
              data-test-id="writer-cert-create"
              @click="create"
            >
              {{ t.createCertificate }}
            </AppButton>
            <AppButton size="sm" variant="outline" :disabled="busy" @click="chooseCertificate">
              {{ importFile ? importFile.name : t.importCertificate }}
            </AppButton>
            <AppButton
              v-if="importFile"
              size="sm"
              variant="outline"
              :disabled="busy || !certPassword"
              @click="importCertificate"
            >
              {{ t.apply }}
            </AppButton>
          </div>
        </template>
      </section>
      <section v-if="certificate" class="flex flex-col gap-2">
        <AppButton size="sm" variant="outline" data-test-id="writer-choose-pdf" @click="choosePDF">
          <template #leading><icon-lucide-file-text class="size-3.5" /></template>
          {{ pdf ? pdf.name : t.choosePDF }}
        </AppButton>
        <div :class="ui.formGrid()">
          <AppInput v-model="reason" :aria-label="t.reason" :placeholder="t.reason" />
          <AppInput v-model="location" :aria-label="t.location" :placeholder="t.location" />
        </div>
        <AppSelect v-model="placement" :options="placementOptions" :label="t.signature" />
        <AppInput
          v-model="password"
          type="password"
          autocomplete="current-password"
          :aria-label="t.certificatePassword"
          :placeholder="t.certificatePassword"
          data-test-id="writer-sign-password"
        />
      </section>
      <AppAlert v-if="error" tone="error" :heading="error" />
      <AppAlert v-if="done" tone="success" :heading="t.signed" />
    </div>
    <template #footer>
      <AppButton
        size="sm"
        :disabled="busy || !pdf || !certificate || !password"
        data-test-id="writer-sign"
        @click="sign"
      >
        {{ t.signAndSave }}
      </AppButton>
    </template>
  </AppDialog>
</template>
