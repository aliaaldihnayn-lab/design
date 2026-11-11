import { generateHTML } from '@tiptap/core'

import { twipsToPx, type PageSetup, type WriterNode } from '@lawha/core/writer'

import type { PaginationPage } from '.'
import { writerExtensions } from '../extensions'

/** Space between two sheets in the editor, in CSS pixels. */
export const PAGE_GAP = 24

/** The page's geometry in CSS pixels, as the pagination draws it. */
export function paginationPage(page: PageSetup): PaginationPage {
  const { margins } = page
  return {
    contentHeight: twipsToPx(page.height - margins.top - margins.bottom),
    top: twipsToPx(margins.top),
    bottom: twipsToPx(margins.bottom),
    left: twipsToPx(margins.left),
    right: twipsToPx(margins.right),
    gap: PAGE_GAP,
    headerDistance: twipsToPx(margins.header),
    footerDistance: twipsToPx(margins.footer)
  }
}

let regionExtensions: ReturnType<typeof writerExtensions> | null = null

/** Draws a header or footer into a page gap, its page fields showing this page's numbers. */
export function fillRegion(
  element: HTMLElement,
  region: WriterNode | null,
  page: number,
  pages: number
): void {
  if (!region?.content?.length) return
  regionExtensions ??= writerExtensions({ region: true })
  const html = generateHTML(region, regionExtensions)
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  for (const field of parsed.querySelectorAll('[data-page-field]')) {
    field.textContent = String(field.getAttribute('data-page-field') === 'pageCount' ? pages : page)
  }
  element.replaceChildren(...Array.from(parsed.body.childNodes))
}
