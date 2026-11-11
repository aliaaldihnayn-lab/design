import { useEditor } from '@tiptap/vue-3'
import { computed, shallowRef, watch } from 'vue'

import { writerSections, type WriterNode } from '@lawha/core/writer'

import { writerExtensions } from '@/app/writer/editor/extensions'
import { Pagination } from '@/app/writer/editor/pagination'
import { EMPTY_LAYOUT, type PageLayout } from '@/app/writer/editor/pagination/layout'
import { fillRegion, paginationSection } from '@/app/writer/editor/pagination/regions'
import { setWriterBody, writerAuthor, writerDocument, writerRevision } from '@/app/writer/session'

/**
 * The body editor, kept in step with the session: edits flow out, loaded documents flow in, and
 * the body is cut into pages with each page's header and footer.
 */
export function useWriterEditor(placeholder: () => string) {
  const layout = shallowRef<PageLayout>(EMPTY_LAYOUT)
  const sections = computed(() => writerSections(writerDocument.value))
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
        sections: () => sections.value.map((section) => paginationSection(section.page)),
        region: (kind, element, page, pages, section) =>
          fillRegion(element, sections.value[section]?.[kind] ?? null, page, pages),
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
  /** Each page's sheet, in CSS pixels, for the paper to draw. */
  const sheets = computed(() =>
    layout.value.sections.map((section) => {
      const page = (sections.value.at(section) ?? sections.value.at(-1))?.page
      return page ? paginationSection(page) : null
    })
  )
  return { editor, pages: layout, sheets, sections }
}
