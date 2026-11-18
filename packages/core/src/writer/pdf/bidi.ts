/**
 * The parts of the Unicode bidirectional algorithm (UAX #9) a paragraph of document text needs:
 * embedding levels from the paragraph's direction and each character's strong direction, with
 * numbers kept left to right inside right-to-left text and neutrals taking the direction of the
 * text around them, then the order runs show in on a line (rule L2).
 */

const RTL = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/u
const LTR = /[\p{L}\p{M}]/u
const DIGIT = /[\p{Nd}]/u
/** Characters that join a number they sit inside: 1,000.5 and 10:30 and 2026-11-11. */
const NUMBER_JOINER = /[.,:/\u066B\u066C-]/u

type Kind = 'L' | 'R' | 'N' | 'EN'

function kindOf(char: string): Kind {
  if (RTL.test(char)) return 'R'
  if (DIGIT.test(char)) return 'EN'
  if (LTR.test(char)) return 'L'
  return 'N'
}

/**
 * The embedding level of each UTF-16 code unit of `text`: even is left to right, odd right to
 * left. `rtl` is the paragraph's base direction.
 */
export function bidiLevels(text: string, rtl: boolean): Uint8Array {
  const base = rtl ? 1 : 0
  const chars = Array.from(text)
  const kinds: Kind[] = chars.map(kindOf)
  // A separator between digits belongs to the number.
  for (let i = 1; i < kinds.length - 1; i += 1) {
    if (kinds[i] === 'N' && NUMBER_JOINER.test(chars[i] ?? '')) {
      if (kinds[i - 1] === 'EN' && kinds[i + 1] === 'EN') kinds[i] = 'EN'
    }
  }
  // Strong direction of each character: numbers read left to right, neutrals take their
  // neighbours' direction when both agree, else the paragraph's.
  const strong: Array<'L' | 'R' | null> = kinds.map((kind) => {
    if (kind === 'L') return 'L'
    if (kind === 'R') return 'R'
    return null
  })
  const levels = kinds.map((kind, index) => levelOf(kind, index, strong, rtl))
  // Left-to-right text inside a right-to-left paragraph sits at level 2, numbers inside Arabic
  // too; a left-to-right paragraph keeps its Latin at the base level.
  const out = new Uint8Array(text.length)
  let unit = 0
  chars.forEach((char, index) => {
    const level = Math.max(base, levels[index] ?? base)
    for (let j = 0; j < char.length; j += 1) out[unit + j] = level
    unit += char.length
  })
  return out
}

/**
 * A character's level: left-to-right letters at the base level (2 inside a right-to-left
 * paragraph), right-to-left letters at 1, numbers left to right one level above the Arabic around
 * them, and neutrals the direction of the strong text on both sides when it agrees.
 */
function levelOf(kind: Kind, index: number, strong: Array<'L' | 'R' | null>, rtl: boolean): number {
  const ltrLevel = rtl ? 2 : 0
  const base = rtl ? 'R' : 'L'
  if (kind === 'L') return ltrLevel
  if (kind === 'R') return 1
  const before = previousStrong(strong, index) ?? base
  if (kind === 'EN') return before === 'R' || rtl ? 2 : 0
  const after = nextStrong(strong, index) ?? base
  const direction = before === after ? before : base
  return direction === 'R' ? 1 : ltrLevel
}

function previousStrong(strong: Array<'L' | 'R' | null>, index: number): 'L' | 'R' | null {
  for (let i = index - 1; i >= 0; i -= 1) {
    const value = strong[i]
    if (value) return value
  }
  return null
}

function nextStrong(strong: Array<'L' | 'R' | null>, index: number): 'L' | 'R' | null {
  for (let i = index + 1; i < strong.length; i += 1) {
    const value = strong[i]
    if (value) return value
  }
  return null
}

/**
 * The visual order of runs on one line, by their levels (UAX #9 rule L2): from the highest
 * level down to the lowest odd one, every maximal sequence at that level or above is reversed.
 */
export function visualOrder(levels: readonly number[]): number[] {
  const order = levels.map((_, index) => index)
  if (!levels.length) return order
  const highest = Math.max(...levels)
  const lowestOdd = Math.min(...levels.filter((level) => level % 2 === 1), highest + 1)
  for (let level = highest; level >= lowestOdd && level > 0; level -= 1) {
    let i = 0
    while (i < order.length) {
      if ((levels[order[i] ?? 0] ?? 0) < level) {
        i += 1
        continue
      }
      let j = i
      while (j < order.length && (levels[order[j] ?? 0] ?? 0) >= level) j += 1
      const reversed = order.slice(i, j).reverse()
      order.splice(i, j - i, ...reversed)
      i = j
    }
  }
  return order
}
