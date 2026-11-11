import IconLucideFileText from '~icons/lucide/file-text'
import IconLucidePenTool from '~icons/lucide/pen-tool'
import IconLucideStickyNote from '~icons/lucide/sticky-note'

import type { DocumentKind } from '@lawha/scene-graph'

/** The icon each kind of document shows, on Home's create buttons and before its files' names. */
export const DOCUMENT_KIND_ICONS = {
  design: IconLucidePenTool,
  board: IconLucideStickyNote
} as const satisfies Record<DocumentKind, unknown>

/** The icon of each kind of stored file, document editor files included. */
export const STORED_DOCUMENT_KIND_ICONS = {
  ...DOCUMENT_KIND_ICONS,
  writer: IconLucideFileText
} as const
