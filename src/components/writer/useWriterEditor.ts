import { useEditor } from '@tiptap/vue-3'
import { watch } from 'vue'

import type { WriterNode } from '@lawha/core/writer'

import { writerExtensions } from '@/app/writer/editor/extensions'
import { setWriterBody, writerAuthor, writerDocument, writerRevision } from '@/app/writer/session'

/** The body editor, kept in step with the session: edits flow out, loaded documents flow in. */
export function useWriterEditor(placeholder: () => string) {
  const editor = useEditor({
    extensions: writerExtensions({
      placeholder: placeholder(),
      trackChanges: {
        enabled: () => writerDocument.value.trackChanges,
        author: () => writerAuthor.value
      }
    }),
    content: writerDocument.value.body,
    // The schema's own TextDirection (see writerExtensions) replaces the core one.
    enableCoreExtensions: { textDirection: false },
    editorProps: { attributes: { 'data-test-id': 'writer-body', spellcheck: 'true' } },
    onUpdate: ({ editor: instance }) => {
      setWriterBody(instance.getJSON() as WriterNode)
    }
  })
  watch(writerRevision, () => {
    editor.value?.commands.setContent(writerDocument.value.body, { emitUpdate: false })
  })
  return editor
}
