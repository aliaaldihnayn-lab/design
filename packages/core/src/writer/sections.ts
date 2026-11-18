import * as v from 'valibot'

import type { PageSetup, WriterDocument, WriterNode } from './model'
import { pageSetupSchema, writerNodeSchema } from './schema'

/**
 * A document's sections, as Word divides it: each `sectionBreak` ends one, with the page setup,
 * header, and footer it carries, and the last section is the document's own. A break without a
 * header or footer of its own (one made in the editor) shows the document's.
 */
export interface WriterSection {
  page: PageSetup
  header: WriterNode | null
  footer: WriterNode | null
}

function regionAttr(
  node: WriterNode,
  key: 'header' | 'footer',
  fallback: WriterNode | null
): WriterNode | null {
  if (!node.attrs || !(key in node.attrs)) return fallback
  const parsed = v.safeParse(v.nullable(writerNodeSchema), node.attrs[key])
  return parsed.success ? parsed.output : fallback
}

/** The page setup a section break carries, or null when it has none. */
export function sectionPage(node: WriterNode): PageSetup | null {
  const result = v.safeParse(pageSetupSchema, node.attrs?.page)
  return result.success ? result.output : null
}

/** Each section of the body in order, the document's own last. */
export function writerSections(doc: WriterDocument): WriterSection[] {
  const sections = (doc.body.content ?? []).flatMap((node) =>
    node.type === 'sectionBreak'
      ? [
          {
            page: sectionPage(node) ?? doc.page,
            header: regionAttr(node, 'header', doc.header),
            footer: regionAttr(node, 'footer', doc.footer)
          }
        ]
      : []
  )
  return [...sections, { page: doc.page, header: doc.header, footer: doc.footer }]
}
