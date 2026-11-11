<script setup lang="ts">
import { useHead } from '@unhead/vue'
import { useObjectUrl } from '@vueuse/core'
import { toUint8Array } from 'js-base64'
import { computed, nextTick, onMounted, ref, shallowRef, useTemplateRef } from 'vue'
import { useRoute } from 'vue-router'

import type { SigningView } from '@lawha/cloud/contract'
import { useWriterMessages } from '@lawha/vue/i18n'

import { signingPageClient } from '@/app/cloud/integration'
import { pngBase64 } from '@/app/writer/signature'
import AppButton from '@/components/ui/button/AppButton.vue'
import AppAlert from '@/components/ui/feedback/AppAlert.vue'
import AppInput from '@/components/ui/input/AppInput.vue'
import { writer } from '@/components/writer/ui'
import WriterSignatureDialog from '@/components/writer/WriterSignatureDialog.vue'

/** Where a signer reads the document sent to them and signs or declines it. */
const t = useWriterMessages()
const ui = writer()
const route = useRoute()
const signerId = computed(() => String(route.params.signerId))
// The secret arrives in the fragment and is kept only in memory, out of the address bar.
const secret = window.location.hash.slice(1)
if (secret) history.replaceState(history.state, '', window.location.pathname)

const view = shallowRef<SigningView | null>(null)
const error = ref<string | null>(null)
const signature = ref<string | null>(null)
const signatureOpen = ref(false)
const declining = ref(false)
const reason = ref('')
const busy = ref(false)
const finished = ref<'signed' | 'declined' | null>(null)

useHead({
  title: computed(() => signedPDF.value?.title ?? view.value?.title ?? t.value.signature)
})

/** A completion email's link: the signed PDF itself, downloaded with the token it carries. */
const downloading = signerId.value === 'download'
const signedPDF = shallowRef<{ title: string; pdf: string } | null>(null)
const shownPDF = computed(() => signedPDF.value?.pdf ?? view.value?.pdf)
const pdfBlob = computed(() =>
  shownPDF.value
    ? new Blob([toUint8Array(shownPDF.value).slice().buffer], { type: 'application/pdf' })
    : undefined
)
const download = useTemplateRef<HTMLAnchorElement>('download')
const pdfURL = useObjectUrl(pdfBlob)

const failed = (failure: unknown) =>
  t.value.signFailed({ error: failure instanceof Error ? failure.message : String(failure) })

onMounted(async () => {
  if (downloading) {
    try {
      signedPDF.value = await (await signingPageClient()).downloadSigned(secret)
      await nextTick()
      download.value?.click()
    } catch (failure) {
      error.value = failed(failure)
    }
    return
  }
  try {
    view.value = await (await signingPageClient()).viewSigning(signerId.value, secret)
    if (view.value.signerStatus === 'signed') finished.value = 'signed'
  } catch (failure) {
    error.value = failed(failure)
  }
})

async function sign() {
  if (!signature.value) return
  busy.value = true
  try {
    const client = await signingPageClient()
    await client.signDocument(signerId.value, {
      secret,
      signature: await pngBase64(signature.value),
      agree: true
    })
    finished.value = 'signed'
  } catch (failure) {
    error.value = failed(failure)
  } finally {
    busy.value = false
  }
}

async function decline() {
  busy.value = true
  try {
    await (
      await signingPageClient()
    ).declineSigning(signerId.value, { secret, reason: reason.value })
    finished.value = 'declined'
  } catch (failure) {
    error.value = failed(failure)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div :class="ui.root()" data-test-id="signing-view">
    <div :class="ui.titleRow()">
      <icon-lucide-file-signature class="size-4 shrink-0 text-muted" />
      <span :class="ui.title()">{{ signedPDF?.title ?? view?.title }}</span>
    </div>
    <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4 text-xs">
      <AppAlert v-if="error" tone="error" :heading="error" />
      <template v-if="signedPDF">
        <a ref="download" :href="pdfURL" :download="`${signedPDF.title}.pdf`" hidden />
        <AppButton
          size="sm"
          class="self-start"
          data-test-id="signing-download"
          @click="download?.click()"
          >{{ t.downloadSigned }}</AppButton
        >
        <iframe
          v-if="pdfURL"
          :src="pdfURL"
          :aria-label="signedPDF.title"
          class="min-h-[60vh] w-full rounded-md border border-border bg-white"
        />
      </template>
      <template v-if="view">
        <p class="text-surface">
          {{ view.senderName }}<template v-if="view.message"> · {{ view.message }}</template>
        </p>
        <iframe
          v-if="pdfURL"
          :src="pdfURL"
          :aria-label="view.title"
          class="min-h-[60vh] w-full rounded-md border border-border bg-white"
        />
        <AppAlert v-if="finished === 'signed'" tone="success" :heading="t.signingComplete" />
        <AppAlert v-else-if="finished === 'declined'" tone="info" :heading="t.statusDeclined" />
        <div v-else-if="view.envelopeStatus === 'sent'" class="flex flex-wrap items-center gap-2">
          <img
            v-if="signature"
            :src="signature"
            :alt="t.signature"
            class="h-12 rounded bg-white p-1"
          />
          <AppButton
            size="sm"
            variant="outline"
            data-test-id="signing-draw"
            @click="signatureOpen = true"
          >
            {{ signature ? t.clear : t.signHere }}
          </AppButton>
          <AppButton
            size="sm"
            :disabled="!signature || busy"
            data-test-id="signing-submit"
            @click="sign"
          >
            {{ t.agreeAndSign }}
          </AppButton>
          <AppButton size="sm" variant="ghost" @click="declining = !declining">{{
            t.decline
          }}</AppButton>
          <template v-if="declining">
            <AppInput
              v-model="reason"
              class="w-64"
              :aria-label="t.reason"
              :placeholder="t.reason"
            />
            <AppButton size="sm" variant="outline" :disabled="busy" @click="decline">{{
              t.decline
            }}</AppButton>
          </template>
        </div>
        <AppAlert v-else tone="info" :heading="t.statusVoided" />
      </template>
    </div>
    <WriterSignatureDialog
      v-model:open="signatureOpen"
      @insert="(image) => (signature = image.src)"
    />
  </div>
</template>
