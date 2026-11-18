<script setup lang="ts">
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui'
import { ref } from 'vue'

import { WRITER_TEMPLATE_IDS, type WriterTemplateId } from '@lawha/core/writer'
import { useWriterMessages } from '@lawha/vue/i18n'

import AppButton from '@/components/ui/button/AppButton.vue'
import IconButton from '@/components/ui/button/IconButton.vue'
import { usePopoverUI } from '@/components/ui/overlay/popover'

/** A new blank document, or one from a template. */
const emit = defineEmits<{ create: [template: WriterTemplateId | null] }>()
const t = useWriterMessages()
const popover = usePopoverUI({ content: 'z-50 flex w-60 flex-col gap-0.5 p-1.5' })
const open = ref(false)

const LABELS = {
  'contract-ar': 'templateContractAr',
  'contract-en': 'templateContractEn',
  'invoice-ar': 'templateInvoiceAr',
  'invoice-en': 'templateInvoiceEn',
  'letter-ar': 'templateLetterAr',
  'letter-en': 'templateLetterEn'
} as const satisfies Record<WriterTemplateId, string>

function choose(template: WriterTemplateId | null) {
  emit('create', template)
  open.value = false
}
</script>

<template>
  <PopoverRoot v-model:open="open">
    <PopoverTrigger as-child>
      <IconButton :label="t.newDocument" data-test-id="writer-new">
        <icon-lucide-file-plus class="size-3.5" />
      </IconButton>
    </PopoverTrigger>
    <PopoverPortal>
      <PopoverContent
        :class="popover.content"
        :side-offset="6"
        align="end"
        :aria-label="t.templates"
      >
        <AppButton
          size="sm"
          variant="ghost"
          class="justify-start"
          data-test-id="writer-new-blank"
          @click="choose(null)"
        >
          <template #leading><icon-lucide-file class="size-3.5" /></template>
          {{ t.templateBlank }}
        </AppButton>
        <AppButton
          v-for="id in WRITER_TEMPLATE_IDS"
          :key="id"
          size="sm"
          variant="ghost"
          class="justify-start"
          :data-test-id="`writer-template-${id}`"
          @click="choose(id)"
        >
          <template #leading><icon-lucide-layout-template class="size-3.5" /></template>
          {{ t[LABELS[id]] }}
        </AppButton>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
