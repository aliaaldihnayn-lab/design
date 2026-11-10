<script setup lang="ts">
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui'
import { ref } from 'vue'

import { useWriterMessages } from '@lawha/vue/i18n'

import AppButton from '@/components/ui/button/AppButton.vue'
import IconButton from '@/components/ui/button/IconButton.vue'
import AppInput from '@/components/ui/input/AppInput.vue'
import { usePopoverUI } from '@/components/ui/overlay/popover'

/** Opens a Google Doc from its link; the view runs the open and reports how it went. */
const emit = defineEmits<{ open: [link: string] }>()
const t = useWriterMessages()
const popover = usePopoverUI({ content: 'z-50 flex w-80 flex-col gap-2 p-3' })
const open = ref(false)
const link = ref('')

function submit() {
  if (!link.value.trim()) return
  emit('open', link.value)
  open.value = false
  link.value = ''
}
</script>

<template>
  <PopoverRoot v-model:open="open">
    <PopoverTrigger as-child>
      <IconButton :label="t.openGoogleDoc" data-test-id="writer-google">
        <icon-lucide-cloud-download class="size-3.5" />
      </IconButton>
    </PopoverTrigger>
    <PopoverPortal>
      <PopoverContent :class="popover.content" :side-offset="6" align="end">
        <form class="flex flex-col gap-2" @submit.prevent="submit">
          <label class="text-xs text-muted" for="writer-google-link">{{ t.googleDocLink }}</label>
          <AppInput
            id="writer-google-link"
            v-model="link"
            type="url"
            data-test-id="writer-google-link"
          />
          <AppButton size="sm" type="submit" :disabled="!link.trim()">{{
            t.openGoogleDoc
          }}</AppButton>
        </form>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
