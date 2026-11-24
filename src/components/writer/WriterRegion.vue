<script setup lang="ts">
import { EditorContent, useEditor, type Editor } from '@tiptap/vue-3'
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

/**
 * The header or footer: a small editor in the page margin, repeated on every printed page. The
 * header sits on the first page, which is the first section's: when the first section break has
 * a header of its own (a Word file with several), that is the one shown and edited, through the
 * body `editor` that holds the break; otherwise the document's.
 */
const { kind, body = null } = defineProps<{ kind: 'header' | 'footer'; body?: Editor | null }>()
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

/** The first section break when it carries this region of its own. */
function ownedByFirstSection(): boolean {
  if (kind !== 'header') return false
  const first = writerDocument.value.body.content?.find((node) => node.type === 'sectionBreak')
  return first?.attrs?.header !== undefined
}

const shown = () =>
  (ownedByFirstSection()
    ? (writerDocument.value.body.content?.find((node) => node.type === 'sectionBreak')?.attrs
        ?.header as WriterNode | null | undefined)
    : writerDocument.value[kind]) ?? EMPTY

/** Writes the region onto the first section break in the body editor; false when it has none. */
function setFirstSectionRegion(value: WriterNode | null): boolean {
  if (!body || !ownedByFirstSection()) return false
  let position = -1
  body.state.doc.forEach((node, offset) => {
    if (position === -1 && node.type.name === 'sectionBreak') position = offset
  })
  const node = position === -1 ? null : body.state.doc.nodeAt(position)
  if (!node) return false
  body.view.dispatch(
    body.state.tr.setNodeMarkup(position, undefined, { ...node.attrs, [kind]: value })
  )
  return true
}

const editor = useEditor({
  extensions: writerExtensions({ region: true, placeholder: t.value[kind] }),
  content: shown(),
  enableCoreExtensions: { textDirection: false },
  editorProps: { attributes: { 'data-test-id': `writer-${kind}` } },
  onUpdate: ({ editor: instance }) => {
    const json = instance.getJSON() as WriterNode
    const value = isEmpty(json) ? null : json
    if (!setFirstSectionRegion(value)) updateWriterDocument({ [kind]: value })
  }
})

watch([writerRevision, writerRegionsRevision], () => {
  editor.value?.commands.setContent(shown(), { emitUpdate: false })
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
