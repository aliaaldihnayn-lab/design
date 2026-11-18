<script setup lang="ts">
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui'

import type { WriterStatistics } from '@lawha/core/writer'
import { useWriterMessages } from '@lawha/vue/i18n'

import { usePopoverUI } from '@/components/ui/overlay/popover'

import { writer } from './ui'

/** The word count, with characters and paragraphs on click, as Word's status bar shows it. */
const { statistics } = defineProps<{ statistics: WriterStatistics }>()
const t = useWriterMessages()
const ui = writer()
const popover = usePopoverUI({ content: 'z-50 w-56 p-3' })
</script>

<template>
  <PopoverRoot>
    <PopoverTrigger as-child>
      <button
        type="button"
        :class="ui.status()"
        class="rounded px-1.5 hover:bg-hover"
        data-test-id="writer-word-count"
      >
        {{ t.wordsShort({ count: String(statistics.words) }) }}
      </button>
    </PopoverTrigger>
    <PopoverPortal>
      <PopoverContent :class="popover.content" :side-offset="6" align="end">
        <dl class="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-xs">
          <dt class="text-muted">{{ t.words }}</dt>
          <dd>{{ statistics.words }}</dd>
          <dt class="text-muted">{{ t.characters }}</dt>
          <dd>{{ statistics.characters }}</dd>
          <dt class="text-muted">{{ t.charactersNoSpaces }}</dt>
          <dd>{{ statistics.charactersNoSpaces }}</dd>
          <dt class="text-muted">{{ t.paragraphs }}</dt>
          <dd>{{ statistics.paragraphs }}</dd>
        </dl>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
