import { extensions as coreExtensions, type Extensions } from '@tiptap/core'
import Highlight from '@tiptap/extension-highlight'
import Image from '@tiptap/extension-image'
import { TableKit } from '@tiptap/extension-table'
import TextAlign from '@tiptap/extension-text-align'
import { TextStyleKit } from '@tiptap/extension-text-style'
import { CharacterCount, Placeholder } from '@tiptap/extensions'
import StarterKit from '@tiptap/starter-kit'

import {
  Comment,
  Deletion,
  Footnote,
  FormField,
  Insertion,
  PageBreak,
  PageCount,
  PageNumber,
  Subscript,
  Superscript,
  TableOfContents
} from './nodes'
import { Search } from './search'
import { TrackChanges, type TrackChangesOptions } from './track-changes'

export interface WriterExtensionOptions {
  placeholder?: string
  /** Header and footer editors hold one short region: no tables, breaks, or footnotes. */
  region?: boolean
  /** Records typing as tracked changes while `enabled()` says so. */
  trackChanges?: TrackChangesOptions
}

/** The editor schema, whose node and mark names are the ones `@lawha/core/writer` reads. */
export function writerExtensions(options: WriterExtensionOptions = {}): Extensions {
  const extensions: Extensions = [
    // Every paragraph, heading, list and cell carries `dir`; `auto` follows its first letter.
    coreExtensions.TextDirection.configure({ direction: 'auto' }),
    StarterKit.configure({
      codeBlock: false,
      code: false,
      horizontalRule: false,
      blockquote: false,
      link: { openOnClick: false, autolink: true, defaultProtocol: 'https' },
      heading: { levels: [1, 2, 3, 4, 5, 6] }
    }),
    TextStyleKit.configure({ lineHeight: false }),
    Highlight.configure({ multicolor: true }),
    TextAlign.configure({
      types: ['heading', 'paragraph'],
      alignments: ['left', 'center', 'right', 'justify']
    }),
    Image.configure({
      inline: true,
      allowBase64: true,
      resize: { enabled: true, alwaysPreserveAspectRatio: true, minWidth: 16, minHeight: 16 }
    }),
    Superscript,
    Subscript,
    Comment,
    Insertion,
    Deletion,
    PageNumber,
    PageCount,
    FormField,
    CharacterCount,
    Search
  ]
  if (options.trackChanges) extensions.push(TrackChanges.configure(options.trackChanges))
  if (!options.region) {
    extensions.push(
      TableKit.configure({ table: { resizable: true } }),
      PageBreak,
      Footnote,
      TableOfContents
    )
  }
  if (options.placeholder)
    extensions.push(Placeholder.configure({ placeholder: options.placeholder }))
  return extensions
}
