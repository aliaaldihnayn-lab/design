/**
 * The characters a run of PDF glyphs spells, in logical order. PDFs draw glyphs where they go on
 * the page, so right-to-left text is usually stored in visual order, as shaped glyphs: contextual
 * presentation forms, ligatures, and marks drawn apart from their letters. Laid out again as live
 * text those would not shape, so the glyphs go back to the characters they came from.
 */

/** A glyph cluster in visual order, left to right along the text's baseline. */
export interface VisualCluster {
  text: string
}

/** Right-to-left letters; Arabic-Indic digits, though in the Arabic block, read left to right. */
const RTL = /(?![\u0660-\u0669\u06F0-\u06F9])[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/u
const LTR = /[\p{L}\p{N}]/u
const PRESENTATION_FORMS = /[\uFB00-\uFDFF\uFE70-\uFEFF]/gu
/** Brackets a right-to-left line draws mirrored, as Unicode's Bidi_Mirrored pairs. */
const MIRRORED: Record<string, string> = {
  '(': ')',
  ')': '(',
  '[': ']',
  ']': '[',
  '{': '}',
  '}': '{',
  '<': '>',
  '>': '<',
  '«': '»',
  '»': '«'
}

/** Controls (tab and line breaks aside), and the replacement character for unknown glyphs. */
function isDropped(code: number): boolean {
  return (code < 0x20 && code !== 0x09 && code !== 0x0a) || code === 0x7f || code === 0xfffd
}

/** Presentation forms and ligatures as the letters they show; controls and NULs dropped. */
export function normalizeGlyphText(text: string): string {
  return text
    .replace(PRESENTATION_FORMS, (form) => form.normalize('NFKC'))
    .split('')
    .filter((character) => !isDropped(character.charCodeAt(0)))
    .join('')
}

export function isRightToLeft(text: string): boolean {
  return RTL.test(text)
}

/** Whether a cluster reads left to right inside right-to-left text: Latin, digits. */
function isLeftToRight(text: string): boolean {
  return !RTL.test(text) && LTR.test(text)
}

/**
 * Clusters in logical order, from clusters in visual order. Without right-to-left letters it is
 * their order. With them the line reads from the right: right-to-left clusters reverse, while each
 * run of left-to-right clusters (words, numbers, with the spaces and punctuation between them)
 * keeps its order, which undoes the Unicode bidirectional algorithm for a right-to-left paragraph.
 */
export function logicalOrder<T extends VisualCluster>(clusters: readonly T[]): T[] {
  const texts = clusters.map((cluster) => cluster.text)
  if (!texts.some(isRightToLeft)) return [...clusters]
  const segments: T[][] = []
  let index = 0
  while (index < clusters.length) {
    if (!isLeftToRight(texts[index])) {
      const cluster = clusters[index]
      const mirrored = MIRRORED[cluster.text]
      segments.push([mirrored ? { ...cluster, text: mirrored } : cluster])
      index++
      continue
    }
    // A left-to-right run spans neutrals only up to its last left-to-right cluster.
    let end = index
    for (let next = index; next < texts.length && !isRightToLeft(texts[next]); next++) {
      if (isLeftToRight(texts[next])) end = next
    }
    segments.push(clusters.slice(index, end + 1))
    index = end + 1
  }
  return segments.reverse().flat()
}

export function logicalText(clusters: readonly VisualCluster[]): string {
  return logicalOrder(clusters)
    .map((cluster) => cluster.text)
    .join('')
}
