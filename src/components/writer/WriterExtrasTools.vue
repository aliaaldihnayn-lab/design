<script setup lang="ts">
import type { Editor } from '@tiptap/vue-3'
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui'
import { computed, ref } from 'vue'

import { detectDirection } from '@lawha/core/writer'
import { randomHex } from '@lawha/scene-graph/random'
import { useWriterMessages } from '@lawha/vue/i18n'

import { updateWriterDocument, writerDocument } from '@/app/writer/session'
import AppButton from '@/components/ui/button/AppButton.vue'
import IconButton from '@/components/ui/button/IconButton.vue'
import AppInput from '@/components/ui/input/AppInput.vue'
import { usePopoverUI } from '@/components/ui/overlay/popover'
import AppSelect from '@/components/ui/select/AppSelect.vue'

import { writer } from './ui'

/** Fillable fields, footnotes, a table of contents, and the watermark. */
const { editor } = defineProps<{ editor: Editor }>()
const t = useWriterMessages()
const ui = writer()
const popover = usePopoverUI({ content: 'z-50 flex w-72 flex-col gap-2 p-3 text-xs' })

type FieldKind = 'text' | 'date' | 'checkbox'
const fieldOpen = ref(false)
const fieldKind = ref<FieldKind>('text')
const fieldName = ref('')
const fieldOptions = computed(() => [
  { value: 'text' as const, label: t.value.fieldText },
  { value: 'date' as const, label: t.value.fieldDate },
  { value: 'checkbox' as const, label: t.value.fieldCheckbox }
])

function insertField() {
  const name =
    fieldName.value.trim() ||
    fieldOptions.value.find((option) => option.value === fieldKind.value)?.label ||
    ''
  editor.chain().focus().insertFormField({ kind: fieldKind.value, name }).run()
  fieldOpen.value = false
  fieldName.value = ''
}

const footnoteOpen = ref(false)
const footnoteText = ref('')

/** The note's text goes with the document; the reference is a numbered mark in the text. */
function insertFootnote() {
  const text = footnoteText.value.trim()
  if (!text) return
  const id = `fn-${randomHex(6)}`
  updateWriterDocument({
    footnotes: [
      ...writerDocument.value.footnotes,
      {
        id,
        content: [
          {
            type: 'paragraph',
            attrs: { dir: detectDirection(text) ?? 'auto' },
            content: [{ type: 'text', text }]
          }
        ]
      }
    ]
  })
  editor.chain().focus().insertFootnote(id).run()
  footnoteOpen.value = false
  footnoteText.value = ''
}

const watermarkOpen = ref(false)
const watermarkDraft = ref('')

function openWatermark(open: boolean) {
  watermarkOpen.value = open
  if (open) watermarkDraft.value = writerDocument.value.watermark?.text ?? ''
}

function setWatermark(text: string | null) {
  updateWriterDocument({ watermark: text?.trim() ? { text: text.trim() } : null })
  watermarkOpen.value = false
}
</script>

<template>
  <div :class="ui.group()">
    <PopoverRoot v-model:open="fieldOpen">
      <PopoverTrigger as-child>
        <IconButton :label="t.fields" data-test-id="writer-field">
          <icon-lucide-text-cursor-input class="size-3.5" />
        </IconButton>
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverContent :class="popover.content" :side-offset="6" align="start">
          <AppSelect v-model="fieldKind" :options="fieldOptions" :label="t.fields" />
          <AppInput v-model="fieldName" :aria-label="t.fieldName" :placeholder="t.fieldName" />
          <AppButton size="sm" data-test-id="writer-field-insert" @click="insertField">{{
            t.insert
          }}</AppButton>
        </PopoverContent>
      </PopoverPortal>
    </PopoverRoot>
    <PopoverRoot v-model:open="footnoteOpen">
      <PopoverTrigger as-child>
        <IconButton :label="t.footnote" data-test-id="writer-footnote">
          <icon-lucide-superscript class="size-3.5" />
        </IconButton>
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverContent :class="popover.content" :side-offset="6" align="start">
          <AppInput
            v-model="footnoteText"
            dir="auto"
            :aria-label="t.footnote"
            :placeholder="t.footnote"
            @keydown.enter.prevent="insertFootnote"
          />
          <AppButton size="sm" :disabled="!footnoteText.trim()" @click="insertFootnote">{{
            t.insert
          }}</AppButton>
        </PopoverContent>
      </PopoverPortal>
    </PopoverRoot>
    <IconButton
      :label="t.tableOfContents"
      data-test-id="writer-toc"
      @click="editor.chain().focus().insertTableOfContents().run()"
    >
      <icon-lucide-list-tree class="size-3.5 rtl:-scale-x-100" />
    </IconButton>
    <PopoverRoot :open="watermarkOpen" @update:open="openWatermark">
      <PopoverTrigger as-child>
        <IconButton
          :label="t.watermark"
          toggle
          :active="writerDocument.watermark !== null"
          data-test-id="writer-watermark"
        >
          <icon-lucide-stamp class="size-3.5" />
        </IconButton>
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverContent :class="popover.content" :side-offset="6" align="start">
          <AppInput
            v-model="watermarkDraft"
            dir="auto"
            :aria-label="t.watermarkText"
            :placeholder="t.watermarkText"
            data-test-id="writer-watermark-text"
          />
          <div class="flex justify-end gap-1.5">
            <AppButton size="sm" variant="ghost" @click="setWatermark(null)">{{
              t.removeWatermark
            }}</AppButton>
            <AppButton
              size="sm"
              data-test-id="writer-watermark-apply"
              @click="setWatermark(watermarkDraft)"
              >{{ t.apply }}</AppButton
            >
          </div>
        </PopoverContent>
      </PopoverPortal>
    </PopoverRoot>
  </div>
</template>
