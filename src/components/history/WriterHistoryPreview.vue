<script setup lang="ts">
import { EditorContent, useEditor } from '@tiptap/vue-3'
import { computed, watch } from 'vue'

import { diffWriterDocuments } from '@lawha/core/history'
import { nodeText, type WriterDocument } from '@lawha/core/writer'
import { useHistoryMessages } from '@lawha/vue/i18n'

import { writerExtensions } from '@/app/writer/editor/extensions'
import { writerDocument } from '@/app/writer/session'

import { historyPanel } from './ui'

/**
 * A version of the document shown read-only where the document was: as it was, or compared
 * with the document now, paragraph by paragraph with the words that changed marked inline.
 */
const { version, mode } = defineProps<{
  version: WriterDocument
  mode: 'version' | 'compare'
}>()

const t = useHistoryMessages()
const ui = historyPanel()

const editor = useEditor({
  extensions: writerExtensions(),
  content: version.body,
  editable: false,
  enableCoreExtensions: { textDirection: false },
  editorProps: { attributes: { 'data-test-id': 'writer-history-preview', 'aria-readonly': 'true' } }
})
watch(
  () => version,
  (next) => editor.value?.commands.setContent(next.body, { emitUpdate: false })
)

const diff = computed(() =>
  mode === 'compare' ? diffWriterDocuments(version, writerDocument.value) : []
)
</script>

<template>
  <div :class="ui.writerPreview()" data-slot="writer-history-preview">
    <EditorContent v-if="mode === 'version'" :editor="editor" />
    <ol v-else :class="ui.writerDiff()" :aria-label="t.comparing" data-slot="writer-history-diff">
      <li
        v-for="(entry, index) in diff"
        :key="index"
        :class="ui.writerBlock()"
        :data-change="entry.kind"
        data-slot="writer-history-block"
      >
        <template v-if="entry.kind === 'changed'">
          <template v-for="(run, runIndex) in entry.runs" :key="runIndex">
            <ins v-if="run.op === 'insert'" :class="ui.writerInsert()">{{ run.text }}</ins>
            <del v-else-if="run.op === 'delete'" :class="ui.writerDelete()">{{ run.text }}</del>
            <span v-else>{{ run.text }}</span>
          </template>
        </template>
        <template v-else>{{ nodeText(entry.block) }}</template>
      </li>
      <li v-if="diff.every((entry) => entry.kind === 'same')" :class="ui.status()">
        {{ t.comparisonEmpty }}
      </li>
    </ol>
  </div>
</template>
