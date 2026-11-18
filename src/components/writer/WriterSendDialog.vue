<script setup lang="ts">
import { fromUint8Array } from 'js-base64'
import { computed, ref, watch } from 'vue'

import type { SignatureEnvelope } from '@lawha/cloud/contract'
import { useWriterMessages } from '@lawha/vue/i18n'

import { cloudSignatureClient, cloudSignaturesAvailable } from '@/app/cloud/integration'
import { useDateFormat } from '@/app/i18n/date'
import { PDF, pickFile, saveFileAs, type PickedFile } from '@/app/writer/files'
import AppButton from '@/components/ui/button/AppButton.vue'
import IconButton from '@/components/ui/button/IconButton.vue'
import { AppDialog } from '@/components/ui/dialog'
import AppAlert from '@/components/ui/feedback/AppAlert.vue'
import AppInput from '@/components/ui/input/AppInput.vue'
import AppTextarea from '@/components/ui/input/AppTextarea.vue'

import { writer } from './ui'

/** Sends a PDF for signature through Lawha Cloud and follows the requests already sent. */
const open = defineModel<boolean>('open', { default: false })
const t = useWriterMessages()
const dates = useDateFormat()
const ui = writer()

interface SignerDraft {
  key: number
  name: string
  email: string
}

const pdf = ref<PickedFile | null>(null)
const title = ref('')
const message = ref('')
let nextKey = 1
const signers = ref<SignerDraft[]>([{ key: 0, name: '', email: '' }])
const busy = ref(false)
const error = ref<string | null>(null)
const sent = ref(false)
const envelopes = ref<SignatureEnvelope[]>([])
const expanded = ref<string | null>(null)

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const ready = computed(
  () =>
    pdf.value !== null &&
    title.value.trim().length > 0 &&
    signers.value.every((signer) => signer.name.trim() && EMAIL.test(signer.email.trim()))
)

const STATUS_LABELS = {
  sent: 'statusSent',
  completed: 'statusCompleted',
  declined: 'statusDeclined',
  voided: 'statusVoided'
} as const
const SIGNER_LABELS = {
  pending: 'signerPending',
  viewed: 'signerViewed',
  signed: 'signerSigned',
  declined: 'signerDeclined'
} as const

async function refresh() {
  const client = cloudSignatureClient()
  if (!client) return
  try {
    envelopes.value = await client.listSignatureEnvelopes()
  } catch (failure) {
    error.value = t.value.signFailed({
      error: failure instanceof Error ? failure.message : String(failure)
    })
  }
}

watch(open, (isOpen) => {
  if (!isOpen) return
  error.value = null
  sent.value = false
  void refresh()
})

async function choosePDF() {
  pdf.value = await pickFile(PDF)
  if (pdf.value && !title.value) title.value = pdf.value.name.replace(/\.pdf$/i, '')
}

function addSigner() {
  signers.value = [...signers.value, { key: nextKey++, name: '', email: '' }]
}

function removeSigner(key: number) {
  signers.value = signers.value.filter((signer) => signer.key !== key)
}

async function send() {
  const client = cloudSignatureClient()
  if (!client || !pdf.value) return
  busy.value = true
  error.value = null
  try {
    await client.sendForSignature({
      title: title.value.trim(),
      message: message.value.trim(),
      pdf: fromUint8Array(pdf.value.bytes),
      signers: signers.value.map((signer) => ({
        name: signer.name.trim(),
        email: signer.email.trim()
      }))
    })
    sent.value = true
    pdf.value = null
    title.value = ''
    message.value = ''
    signers.value = [{ key: nextKey++, name: '', email: '' }]
    await refresh()
  } catch (failure) {
    error.value = t.value.signFailed({
      error: failure instanceof Error ? failure.message : String(failure)
    })
  } finally {
    busy.value = false
  }
}

async function download(envelope: SignatureEnvelope) {
  const client = cloudSignatureClient()
  if (!client) return
  const bytes = await client.downloadSignaturePDF(envelope.id)
  await saveFileAs(bytes, `${envelope.title}-signed.pdf`, PDF)
}

const signerName = (envelope: SignatureEnvelope, id: string | null) =>
  envelope.signers.find((signer) => signer.id === id)?.email ?? ''
</script>

<template>
  <AppDialog
    v-model:open="open"
    size="lg"
    :heading="t.sendForSignature"
    :description="t.sendForSignatureDescription"
    :close-label="t.cancel"
    data-test-id="writer-send-dialog"
  >
    <div :class="ui.form()">
      <AppAlert v-if="!cloudSignaturesAvailable" tone="warning" :heading="t.cloudRequired" />
      <template v-else>
        <AppButton size="sm" variant="outline" class="self-start" @click="choosePDF">
          <template #leading><icon-lucide-file-text class="size-3.5" /></template>
          {{ pdf ? pdf.name : t.choosePDF }}
        </AppButton>
        <AppInput v-model="title" :aria-label="t.subject" :placeholder="t.subject" />
        <AppTextarea v-model="message" :rows="2" :aria-label="t.message" :placeholder="t.message" />
        <span class="font-semibold">{{ t.signers }}</span>
        <div v-for="signer in signers" :key="signer.key" class="flex items-center gap-1.5">
          <AppInput
            v-model="signer.name"
            class="flex-1"
            :aria-label="t.signerName"
            :placeholder="t.signerName"
          />
          <AppInput
            v-model="signer.email"
            type="email"
            class="flex-1"
            :aria-label="t.signerEmail"
            :placeholder="t.signerEmail"
          />
          <IconButton
            :label="t.removeSigner"
            :disabled="signers.length === 1"
            @click="removeSigner(signer.key)"
          >
            <icon-lucide-x class="size-3.5" />
          </IconButton>
        </div>
        <AppButton size="xs" variant="ghost" class="self-start" @click="addSigner">
          <template #leading><icon-lucide-user-plus class="size-3.5" /></template>
          {{ t.addSigner }}
        </AppButton>
        <AppAlert v-if="sent" tone="success" :heading="t.envelopeSent" />
        <AppAlert v-if="error" tone="error" :heading="error" />
        <template v-if="envelopes.length">
          <span class="mt-2 font-semibold">{{ t.envelopes }}</span>
          <article
            v-for="envelope in envelopes"
            :key="envelope.id"
            :class="ui.card()"
            data-test-id="writer-envelope"
          >
            <div class="flex items-center justify-between gap-2">
              <span class="font-semibold text-surface">{{ envelope.title }}</span>
              <span class="text-muted">{{ t[STATUS_LABELS[envelope.status]] }}</span>
            </div>
            <span v-for="signer in envelope.signers" :key="signer.id" class="text-muted">
              {{ signer.name }} · {{ signer.email }} · {{ t[SIGNER_LABELS[signer.status]] }}
            </span>
            <div class="flex justify-end gap-1">
              <AppButton
                size="xs"
                variant="ghost"
                @click="expanded = expanded === envelope.id ? null : envelope.id"
              >
                {{ t.auditTrail }}
              </AppButton>
              <AppButton size="xs" variant="ghost" @click="download(envelope)">
                {{ envelope.status === 'completed' ? t.downloadSigned : t.choosePDF }}
              </AppButton>
            </div>
            <ol
              v-if="expanded === envelope.id"
              class="flex flex-col gap-0.5 text-[10px] text-muted"
            >
              <li v-for="event in envelope.events" :key="event.id">
                {{ dates.format(event.at, 'dateTime') }} · {{ event.kind }} ·
                {{ signerName(envelope, event.signerId) }}
                {{ event.ipAddress ?? '' }}
              </li>
              <li>SHA-256 {{ envelope.originalSHA256 }}</li>
            </ol>
          </article>
        </template>
      </template>
    </div>
    <template #footer>
      <AppButton
        size="sm"
        :disabled="busy || !ready || !cloudSignaturesAvailable"
        data-test-id="writer-send"
        @click="send"
      >
        {{ t.send }}
      </AppButton>
    </template>
  </AppDialog>
</template>
