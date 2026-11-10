<script setup lang="ts">
import type { Editor } from '@tiptap/vue-3'
import { fromUint8Array } from 'js-base64'
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui'
import { computed, ref } from 'vue'

import { useWriterMessages } from '@lawha/vue/i18n'

import AppButton from '@/components/ui/button/AppButton.vue'
import IconButton from '@/components/ui/button/IconButton.vue'
import AppInput from '@/components/ui/input/AppInput.vue'
import { usePopoverUI } from '@/components/ui/overlay/popover'

import { writer } from './ui'

/** Links, images, tables and page breaks, plus row and column edits while in a table. */
const { editor } = defineProps<{ editor: Editor }>()
const t = useWriterMessages()
const ui = writer()
const popover = usePopoverUI({ content: 'z-50 flex w-72 flex-col gap-2 p-3' })

const linkOpen = ref(false)
const linkDraft = ref('')

function openLink(open: boolean) {
  linkOpen.value = open
  if (!open) return
  const href: unknown = editor.getAttributes('link').href
  linkDraft.value = typeof href === 'string' ? href : ''
}

function applyLink() {
  const href = linkDraft.value.trim()
  const chain = editor.chain().focus().extendMarkRange('link')
  if (href) chain.setLink({ href }).run()
  else chain.unsetLink().run()
  linkOpen.value = false
}

function removeLink() {
  editor.chain().focus().extendMarkRange('link').unsetLink().run()
  linkOpen.value = false
}

const imageInput = ref<HTMLInputElement | null>(null)

/** Images are embedded as data URLs, so the document carries them into Word. */
async function insertImage(event: Event) {
  const input = event.target instanceof HTMLInputElement ? event.target : null
  const file = input?.files?.[0]
  if (!file) return
  const bytes = new Uint8Array(await file.arrayBuffer())
  const src = `data:${file.type || 'image/png'};base64,${fromUint8Array(bytes)}`
  const size = await naturalSize(src)
  const width = Math.min(size.width, 600)
  editor
    .chain()
    .focus()
    .setImage({
      src,
      alt: file.name,
      width,
      height: Math.round((size.height * width) / size.width)
    })
    .run()
  if (input) input.value = ''
}

function naturalSize(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const image = new Image()
    image.addEventListener('load', () =>
      resolve({ width: image.naturalWidth || 300, height: image.naturalHeight || 200 })
    )
    image.addEventListener('error', () => resolve({ width: 300, height: 200 }))
    image.src = src
  })
}

const inTable = computed(() => editor.isActive('table'))

/** A table takes the direction of the paragraph it is inserted at, so Arabic tables start right. */
function insertTable() {
  const { $from } = editor.state.selection
  const dir: unknown = $from.parent.attrs.dir
  editor
    .chain()
    .focus()
    .insertTable({ rows: 3, cols: 3, withHeaderRow: false })
    .updateAttributes('table', { dir: dir === 'rtl' || dir === 'ltr' ? dir : 'auto' })
    .run()
}
</script>

<template>
  <div :class="ui.group()">
    <PopoverRoot :open="linkOpen" @update:open="openLink">
      <PopoverTrigger as-child>
        <IconButton
          :label="t.link"
          toggle
          :active="editor.isActive('link')"
          data-test-id="writer-link"
        >
          <icon-lucide-link class="size-3.5" />
        </IconButton>
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverContent :class="popover.content" :side-offset="6" align="start">
          <form class="flex flex-col gap-2" @submit.prevent="applyLink">
            <AppInput
              v-model="linkDraft"
              type="url"
              :aria-label="t.linkAddress"
              :placeholder="t.linkAddress"
            />
            <div class="flex justify-end gap-1.5">
              <AppButton size="sm" variant="ghost" @click="removeLink">{{
                t.removeLink
              }}</AppButton>
              <AppButton size="sm" type="submit">{{ t.apply }}</AppButton>
            </div>
          </form>
        </PopoverContent>
      </PopoverPortal>
    </PopoverRoot>
    <IconButton :label="t.image" @click="imageInput?.click()">
      <icon-lucide-image class="size-3.5" />
    </IconButton>
    <input
      ref="imageInput"
      type="file"
      accept="image/png,image/jpeg,image/gif"
      class="sr-only"
      tabindex="-1"
      @change="insertImage"
    />
    <IconButton :label="t.table" data-test-id="writer-table" @click="insertTable">
      <icon-lucide-table class="size-3.5" />
    </IconButton>
    <IconButton
      :label="t.pageBreak"
      data-test-id="writer-page-break"
      @click="editor.chain().focus().setPageBreak().run()"
    >
      <icon-lucide-separator-horizontal class="size-3.5" />
    </IconButton>
  </div>
  <div v-if="inTable" :class="ui.group()" data-test-id="writer-table-tools">
    <IconButton :label="t.addRowBefore" @click="editor.chain().focus().addRowBefore().run()">
      <icon-lucide-between-vertical-start class="size-3.5" />
    </IconButton>
    <IconButton :label="t.addRowAfter" @click="editor.chain().focus().addRowAfter().run()">
      <icon-lucide-between-vertical-end class="size-3.5" />
    </IconButton>
    <IconButton :label="t.addColumnBefore" @click="editor.chain().focus().addColumnBefore().run()">
      <icon-lucide-between-horizontal-start class="size-3.5" />
    </IconButton>
    <IconButton :label="t.addColumnAfter" @click="editor.chain().focus().addColumnAfter().run()">
      <icon-lucide-between-horizontal-end class="size-3.5" />
    </IconButton>
    <IconButton
      :label="t.mergeCells"
      :disabled="!editor.can().mergeCells()"
      @click="editor.chain().focus().mergeCells().run()"
    >
      <icon-lucide-table-cells-merge class="size-3.5" />
    </IconButton>
    <IconButton
      :label="t.splitCell"
      :disabled="!editor.can().splitCell()"
      @click="editor.chain().focus().splitCell().run()"
    >
      <icon-lucide-table-cells-split class="size-3.5" />
    </IconButton>
    <IconButton :label="t.headerRow" @click="editor.chain().focus().toggleHeaderRow().run()">
      <icon-lucide-panel-top class="size-3.5" />
    </IconButton>
    <IconButton :label="t.deleteRow" @click="editor.chain().focus().deleteRow().run()">
      <icon-lucide-rows-3 class="size-3.5" />
    </IconButton>
    <IconButton :label="t.deleteColumn" @click="editor.chain().focus().deleteColumn().run()">
      <icon-lucide-columns-3 class="size-3.5" />
    </IconButton>
    <IconButton :label="t.deleteTable" @click="editor.chain().focus().deleteTable().run()">
      <icon-lucide-trash-2 class="size-3.5" />
    </IconButton>
  </div>
</template>
