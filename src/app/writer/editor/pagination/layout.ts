/**
 * Where the editor's pages break: the body's blocks as the browser laid them out in one column,
 * cut into pages of the page's text height. A block that does not fit in what is left of a page
 * starts the next one (one taller than a page stays whole and runs over), and a page or section
 * break always does.
 */

/** A top-level block's extent in the unbroken column, in CSS pixels from its top. */
export interface BlockBox {
  top: number
  bottom: number
  /** The block is a page or section break: the next block starts a page. */
  breakAfter: boolean
}

export interface PageBreak {
  /** The block that starts the page. */
  index: number
  /** The text area left empty at the foot of the page before it, in CSS pixels. */
  fill: number
}

export interface PageLayout {
  breaks: PageBreak[]
  pages: number
  /** The text area left empty at the foot of the last page. */
  lastFill: number
}

/** Fractions of a pixel the browser rounds away, so a block that just fits is not moved. */
const TOLERANCE = 1

export function layoutPages(blocks: readonly BlockBox[], pageHeight: number): PageLayout {
  const breaks: PageBreak[] = []
  if (pageHeight <= 0 || !blocks.length) return { breaks, pages: 1, lastFill: pageHeight }
  let pageTop = blocks[0]?.top ?? 0
  let forced = false
  for (const [index, block] of blocks.entries()) {
    const overflows = block.bottom - pageTop > pageHeight + TOLERANCE
    if (index > 0 && (forced || (overflows && block.top > pageTop))) {
      breaks.push({ index, fill: Math.max(0, pageTop + pageHeight - block.top) })
      pageTop = block.top
    }
    forced = block.breakAfter
  }
  const last = blocks.at(-1)
  const used = last ? last.bottom - pageTop : 0
  const lastFill = forced ? pageHeight : Math.max(0, pageHeight - used)
  return { breaks, pages: breaks.length + 1 + (forced ? 1 : 0), lastFill }
}

/** Whether two layouts put the same breaks in the same places, to the pixel. */
export function sameLayout(a: PageLayout, b: PageLayout): boolean {
  return (
    a.pages === b.pages &&
    Math.round(a.lastFill) === Math.round(b.lastFill) &&
    a.breaks.length === b.breaks.length &&
    a.breaks.every(
      (entry, index) =>
        entry.index === b.breaks[index]?.index &&
        Math.round(entry.fill) === Math.round(b.breaks[index]?.fill ?? -1)
    )
  )
}
