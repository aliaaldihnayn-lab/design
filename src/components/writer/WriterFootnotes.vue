<script setup lang="ts">
import type { Editor } from '@tiptap/vue-3'
import { useEventListener } from '@vueuse/core'
import { computed, ref } from 'vue'

import { numberedFootnotes, setFootnoteContent, type WriterNode } from '@lawha/core/writer'
import { useWriterMessages } from '@lawha/vue/i18n'

import { removeWriterFootnote } from '@/app/writer/footnotes'
import { updateWriterDocument, writerDocument, writerRevision } from '@/app/writer/session'

import { writer } from './ui'
import WriterFootnotesNote from './WriterFootnotesNote.vue'

/**
 * The document's footnotes under the body, numbered by where their references appear, each
 * editable; clicking a reference in the text puts the cursor in its note.
 */
const { editor } = defineProps<{ editor: Editor }>()
const t = useWriterMessages()
const ui = writer()

const notes = computed(() => numberedFootnotes(writerDocument.value))
const editors = ref<Record<string, InstanceType<typeof WriterFootnotesNote> | null>>({})

function change(id: string, content: WriterNode[]) {
  updateWriterDocument(setFootnoteContent(writerDocument.value, id, content))
}

useEventListener(
  () => editor.view.dom,
  'mousedown',
  (event: MouseEvent) => {
    const target = event.target instanceof Element ? event.target : null
    const id = target?.closest('[data-footnote]')?.getAttribute('data-footnote')
    const note = id ? editors.value[id] : null
    if (!note) return
    // Before the body selects the reference, which typing would then replace.
    event.preventDefault()
    event.stopPropagation()
    note.focus()
  },
  { capture: true }
)
</script>

<template>
  <section
    v-if="notes.length"
    :class="ui.footnotes()"
    :aria-label="t.footnotes"
    data-test-id="writer-footnotes"
  >
    <ol class="flex flex-col gap-1">
      <WriterFootnotesNote
        v-for="note in notes"
        :key="note.id"
        :ref="
          (instance) => (editors[note.id] = instance as InstanceType<typeof WriterFootnotesNote>)
        "
        :content="note.content"
        :number="note.number"
        :revision="writerRevision"
        @change="(content) => change(note.id, content)"
        @remove="removeWriterFootnote(editor, note.id)"
      />
    </ol>
  </section>
</template>
