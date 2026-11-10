import { useLocalStorage } from '@vueuse/core'
import { computed, ref, shallowRef } from 'vue'

import {
  createWriterDocument,
  emptyBody,
  type TextDirection,
  type WriterDocument,
  type WriterNode
} from '@lawha/core/writer'

/** Where the open document came from, so Save writes back to the same place. */
export type WriterSource =
  | { kind: 'file'; handle: FileSystemFileHandle | null; path: string | null }
  | { kind: 'google'; documentId: string; revisionId: string | null }

/**
 * The document the document editor shows. The editor view owns the Tiptap instance; this holds
 * what it edits, so saving, the AI tools, and the side panels read one model.
 */
export const writerDocument = shallowRef<WriterDocument>(createWriterDocument())
export const writerSource = shallowRef<WriterSource | null>(null)
export const writerName = ref('')
export const writerDirty = ref(false)
/** Bumped when a different document is loaded, so editors replace their content. */
export const writerRevision = ref(0)

/** Bumped when the header or footer is replaced from outside its editor, such as by a command. */
export const writerRegionsRevision = ref(0)

/** The name comments and tracked changes are signed with. */
export const writerAuthor = useLocalStorage('lawha:writer-author', '')

export const writerTitle = computed(() => writerName.value || writerDocument.value.title)

export function loadWriterDocument(
  document: WriterDocument,
  name: string,
  source: WriterSource | null
): void {
  writerDocument.value = document
  writerName.value = name
  writerSource.value = source
  writerDirty.value = false
  writerRevision.value += 1
}

export function newWriterDocument(dir: TextDirection, template?: WriterDocument): void {
  loadWriterDocument(template ?? createWriterDocument({ body: emptyBody(dir) }), '', null)
}

/** Replaces part of the document, marking it changed. */
export function updateWriterDocument(patch: Partial<WriterDocument>): void {
  writerDocument.value = { ...writerDocument.value, ...patch }
  writerDirty.value = true
}

export function setWriterBody(body: WriterNode): void {
  updateWriterDocument({ body })
}

/** After a save: the document is unchanged since, and Save goes to `source`. */
export function markWriterSaved(source: WriterSource, name?: string): void {
  writerSource.value = source
  if (name !== undefined) writerName.value = name
  writerDirty.value = false
}

/** Replaces the header or footer from a command, refreshing its editor. */
export function setWriterRegion(kind: 'header' | 'footer', node: WriterNode | null): void {
  updateWriterDocument({ [kind]: node })
  writerRegionsRevision.value += 1
}
