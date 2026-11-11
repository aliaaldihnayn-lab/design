/**
 * Where the editor's pages break: the body's blocks as the browser laid them out in one column,
 * cut into pages of each section's text height. A block that does not fit in what is left of a
 * page starts the next one, and a page or section break always does. A block taller than a page
 * is split where it can be, between the lines of a paragraph or the rows of a table, as Word and
 * Google Docs split it; one that cannot be split stays whole and runs over.
 */

/** A place a tall block can be split: a line of a paragraph or a row of a table. */
export interface BlockPiece {
  top: number
  bottom: number
  /** The document position the page gap goes at, before the line or the row. */
  pos: number
}

/** A top-level block's extent in the unbroken column, in CSS pixels from its top. */
export interface BlockBox {
  top: number
  bottom: number
  /** The block is a page or section break: the next block starts a page. */
  breakAfter: boolean
  /** The block is a section break: what follows is the next section. */
  endsSection?: boolean
  /** The section the block is in; a section break is the last block of its section. */
  section: number
  /** Where the block can be split, in order, when it is taller than a page. */
  pieces?: BlockPiece[]
  /** What the pieces are, which decides how the page gap is drawn inside the block. */
  split?: 'line' | 'row'
}

export interface PageBreak {
  /** The block that starts the page, or the one split across it. */
  index: number
  /** The text area left empty at the foot of the page before it, in CSS pixels. */
  fill: number
  /** Inside a split block: the position of the line or row that starts the page. */
  pos?: number
  split?: 'line' | 'row'
}

export interface PageLayout {
  breaks: PageBreak[]
  pages: number
  /** The text area left empty at the foot of the last page. */
  lastFill: number
  /** The section of each page. */
  sections: number[]
}

/** Fractions of a pixel the browser rounds away, so a block that just fits is not moved. */
const TOLERANCE = 1

export const EMPTY_LAYOUT: PageLayout = { breaks: [], pages: 1, lastFill: 0, sections: [0] }

export function layoutPages(
  blocks: readonly BlockBox[],
  pageHeight: (section: number) => number
): PageLayout {
  const breaks: PageBreak[] = []
  const first = blocks.at(0)
  if (!first) return { breaks, pages: 1, lastFill: pageHeight(0), sections: [0] }
  const sections = [first.section]
  let pageTop = first.top
  let section = first.section
  let forced = false
  const startPage = (entry: PageBreak, top: number, next: number) => {
    breaks.push(entry)
    pageTop = top
    section = next
    sections.push(next)
  }
  for (const [index, block] of blocks.entries()) {
    const height = pageHeight(section)
    if (height <= 0) return { breaks: [], pages: 1, lastFill: 0, sections: [first.section] }
    const tall = block.bottom - block.top > pageHeight(block.section) + TOLERANCE
    const pieces = tall ? (block.pieces ?? []) : []
    const firstPiece = pieces.at(0)
    // A tall block starts on the page it reaches when at least its first piece fits there.
    const startsHere = firstPiece !== undefined && firstPiece.bottom - pageTop <= height + TOLERANCE
    const overflows = block.bottom - pageTop > height + TOLERANCE
    if (index > 0 && (forced || (overflows && block.top > pageTop && !startsHere))) {
      startPage(
        { index, fill: Math.max(0, pageTop + height - block.top) },
        block.top,
        block.section
      )
    }
    for (const piece of pieces.slice(1)) {
      const room = pageHeight(section)
      if (piece.bottom - pageTop > room + TOLERANCE && piece.top > pageTop) {
        startPage(
          {
            index,
            fill: Math.max(0, pageTop + room - piece.top),
            pos: piece.pos,
            split: block.split
          },
          piece.top,
          section
        )
      }
    }
    forced = block.breakAfter
  }
  return closeLayout({ breaks, sections, blocks, pageTop, forced, section, pageHeight })
}

interface LayoutEnd {
  breaks: PageBreak[]
  sections: number[]
  blocks: readonly BlockBox[]
  pageTop: number
  forced: boolean
  section: number
  pageHeight: (section: number) => number
}

/** The layout once every block is placed: the last page's fill, and the page a final break opens. */
function closeLayout(end: LayoutEnd): PageLayout {
  const { breaks, sections, blocks, pageTop, forced, pageHeight } = end
  const last = blocks.at(-1)
  const used = last ? last.bottom - pageTop : 0
  if (forced && last) sections.push(last.section + (last.endsSection ? 1 : 0))
  const lastHeight = pageHeight(sections.at(-1) ?? end.section)
  const lastFill = forced ? lastHeight : Math.max(0, lastHeight - used)
  return { breaks, pages: breaks.length + 1 + (forced ? 1 : 0), lastFill, sections }
}

/** Whether two layouts put the same breaks in the same places, to the pixel. */
export function sameLayout(a: PageLayout, b: PageLayout): boolean {
  return (
    a.pages === b.pages &&
    Math.round(a.lastFill) === Math.round(b.lastFill) &&
    a.sections.join(',') === b.sections.join(',') &&
    a.breaks.length === b.breaks.length &&
    a.breaks.every((entry, index) => {
      const other = b.breaks.at(index)
      return (
        other !== undefined &&
        entry.index === other.index &&
        entry.pos === other.pos &&
        Math.round(entry.fill) === Math.round(other.fill)
      )
    })
  )
}
