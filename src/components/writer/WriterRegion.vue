<script setup lang="ts">
import { EditorContent, useEditor } from '@tiptap/vue-3'
import { onBeforeUnmount, watch } from 'vue'

import { nodeText, type WriterNode } from '@lawha/core/writer'
import { useWriterMessages } from '@lawha/vue/i18n'

import { writerExtensions } from '@/app/writer/editor/extensions'
import {
  updateWriterDocument,
  writerDocument,
  writerRegionsRevision,
  writerRevision
} from '@/app/writer/session'
import IconButton from '@/components/ui/button/IconButton.vue'

import { writer } from './ui'

/** The header or footer: a small editor in the page margin, repeated on every printed page. */
const { kind } = defineProps<{ kind: 'header' | 'footer' }>()
const t = useWriterMessages()
const ui = writer()

const EMPTY: WriterNode = { type: 'doc', content: [{ type: 'paragraph' }] }

/** A region with no text and no page fields is no region, so Word gets no empty part. */
function isEmpty(node: WriterNode): boolean {
  if (nodeText(node).trim()) return false
  let field = false
  const visit = (child: WriterNode) => {
    if (['pageNumber', 'pageCount', 'image', 'formField'].includes(child.type)) field = true
    child.content?.forEach(visit)
  }
  visit(node)
  return !field
}

const editor = useEditor({
  extensions: writerExtensions({ region: true, placeholder: t.value[kind] }),
  content: writerDocument.value[kind] ?? EMPTY,
  enableCoreExtensions: { textDirection: false },
  editorProps: { attributes: { 'data-test-id': `writer-${kind}` } },
  onUpdate: ({ editor: instance }) => {
    const json = instance.getJSON() as WriterNode
    updateWriterDocument({ [kind]: isEmpty(json) ? null : json })
  }
})

watch([writerRevision, writerRegionsRevision], () => {
  editor.value?.commands.setContent(writerDocument.value[kind] ?? EMPTY, { emitUpdate: false })
})

onBeforeUnmount(() => editor.value?.destroy())

function insertField(field: 'pageNumber' | 'pageCount') {
  editor.value?.chain().focus().insertPageField(field).run()
}
</script>

<template>
  <div :class="ui.region()" :data-kind="kind">
    <div :class="ui.regionTools()">
      <IconButton :label="t.pageNumber" @mousedown.prevent @click="insertField('pageNumber')">
        <icon-lucide-hash class="size-3" />
      </IconButton>
      <IconButton :label="t.pageCount" @mousedown.prevent @click="insertField('pageCount')">
        <icon-lucide-sigma class="size-3" />
      </IconButton>
    </div>
    <EditorContent v-if="editor" :editor="editor" :class="ui.content()" />
  </div>
</template>
