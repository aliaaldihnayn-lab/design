import { useEditor } from '@tiptap/vue-3'
import { shallowRef, watch } from 'vue'

import type { WriterNode } from '@lawha/core/writer'

import { writerExtensions } from '@/app/writer/editor/extensions'
import { Pagination } from '@/app/writer/editor/pagination'
import type { PageLayout } from '@/app/writer/editor/pagination/layout'
import { fillRegion, paginationPage } from '@/app/writer/editor/pagination/regions'
import { setWriterBody, writerAuthor, writerDocument, writerRevision } from '@/app/writer/session'

/**
 * The body editor, kept in step with the session: edits flow out, loaded documents flow in, and
 * the body is cut into pages with each page's header and footer.
 */
export function useWriterEditor(placeholder: () => string) {
  const layout = shallowRef<PageLayout>({ breaks: [], pages: 1, lastFill: 0 })
  const editor = useEditor({
    extensions: [
      ...writerExtensions({
        placeholder: placeholder(),
        trackChanges: {
          enabled: () => writerDocument.value.trackChanges,
          author: () => writerAuthor.value
        }
      }),
      Pagination.configure({
        page: () => paginationPage(writerDocument.value.page),
        region: (kind, element, page, pages) =>
          fillRegion(element, writerDocument.value[kind], page, pages),
        onLayout: (next) => {
          layout.value = next
        }
      })
    ],
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
  // Headers, footers and the page setup draw into every page gap.
  watch(
    () => [writerDocument.value.header, writerDocument.value.footer, writerDocument.value.page],
    () => editor.value?.commands.repaginate()
  )
  return { editor, pages: layout }
}
