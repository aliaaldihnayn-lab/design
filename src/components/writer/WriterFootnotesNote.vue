<script setup lang="ts">
import { EditorContent, useEditor } from '@tiptap/vue-3'
import { onBeforeUnmount, watch } from 'vue'

import type { WriterNode } from '@lawha/core/writer'
import { useWriterMessages } from '@lawha/vue/i18n'

import { writerExtensions } from '@/app/writer/editor/extensions'
import IconButton from '@/components/ui/button/IconButton.vue'

import { writer } from './ui'

/** One footnote's text, edited in place under the body as Word edits it in the page's foot. */
const { content, number, revision } = defineProps<{
  content: WriterNode[]
  number: number | null
  /** Bumped when the note is replaced from outside this editor. */
  revision: number
}>()
const emit = defineEmits<{ change: [content: WriterNode[]]; remove: [] }>()
const t = useWriterMessages()
const ui = writer()

const asDoc = (paragraphs: WriterNode[]): WriterNode => ({
  type: 'doc',
  content: paragraphs.length ? paragraphs : [{ type: 'paragraph' }]
})

const editor = useEditor({
  extensions: writerExtensions({ region: true }),
  content: asDoc(content),
  enableCoreExtensions: { textDirection: false },
  editorProps: { attributes: { 'aria-label': t.value.footnote } },
  onUpdate: ({ editor: instance }) => {
    emit('change', (instance.getJSON() as WriterNode).content ?? [])
  }
})

watch(
  () => revision,
  () => editor.value?.commands.setContent(asDoc(content), { emitUpdate: false })
)

onBeforeUnmount(() => editor.value?.destroy())

/** Puts the cursor at the note's end at once, before the next key arrives. */
function focus() {
  const instance = editor.value
  if (!instance) return
  instance.view.focus()
  instance.commands.setTextSelection(instance.state.doc.content.size)
}

defineExpose({ focus })
</script>

<template>
  <li :class="ui.footnote()" data-test-id="writer-footnote-note">
    <span :class="ui.footnoteNumber()">{{ number ?? '–' }}</span>
    <EditorContent v-if="editor" :editor="editor" :class="[ui.content(), ui.footnoteText()]" />
    <IconButton :label="t.deleteFootnote" :class="ui.footnoteRemove()" @click="emit('remove')">
      <icon-lucide-x class="size-3" />
    </IconButton>
  </li>
</template>
