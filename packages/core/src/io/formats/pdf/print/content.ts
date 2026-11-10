import { formatNumber, matchSpot, rgbToCMYK, type PDFSpotColor } from './color'

/**
 * Content-stream colour rewriting: DeviceRGB and DeviceGray colour operators become DeviceCMYK,
 * and a colour that names a spot ink becomes that ink's Separation at full tint.
 */

/** A token: a string, a hex string, a dictionary bracket, a name, a number, or an operator. */
const TOKEN =
  /\((?:\\[\s\S]|[^\\)])*\)|<<|>>|<[0-9A-Fa-f\s]*>|\/[^\s/[\]()<>{}%]*|[+-]?(?:\d+\.?\d*|\.\d+)|[A-Za-z'"*]+|%[^\n\r]*|[[\]{}]|\s+/y

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)$/

/** The resource name a spot ink's colour space has in every resource dictionary. */
export function spotResourceName(index: number): string {
  return `LawhaSpot${index + 1}`
}

export interface ContentRewrite {
  text: string
  /** Spot inks the content now paints with, by index into the spots. */
  spotsUsed: Set<number>
  /** Font resources the content sets text in. */
  fontsUsed: Set<string>
}

function cmykOperator(values: readonly number[], stroke: boolean): string {
  return `${values.map(formatNumber).join(' ')} ${stroke ? 'K' : 'k'}`
}

function rewriteColor(
  operator: string,
  numbers: number[],
  spots: readonly PDFSpotColor[],
  used: Set<number>
): string | null {
  const stroke = operator === 'RG' || operator === 'G'
  if ((operator === 'rg' || operator === 'RG') && numbers.length === 3) {
    const [r, g, b] = numbers
    const spot = matchSpot(spots, r, g, b)
    if (spot >= 0) {
      used.add(spot)
      const name = spotResourceName(spot)
      return stroke ? `/${name} CS 1 SCN` : `/${name} cs 1 scn`
    }
    return cmykOperator(rgbToCMYK(r, g, b), stroke)
  }
  if ((operator === 'g' || operator === 'G') && numbers.length === 1) {
    return cmykOperator([0, 0, 0, 1 - numbers[0]], stroke)
  }
  return null
}

export function rewriteContent(text: string, spots: readonly PDFSpotColor[]): ContentRewrite {
  const out: string[] = []
  const spotsUsed = new Set<number>()
  const fontsUsed = new Set<string>()
  /** Number tokens since the last operator, with where they start in `out`. */
  let operands: { value: number; at: number }[] = []
  let lastName: string | null = null
  let pos = 0
  while (pos < text.length) {
    TOKEN.lastIndex = pos
    const match = TOKEN.exec(text)
    if (!match) {
      // An unreadable byte stays as it is.
      out.push(text[pos])
      pos++
      continue
    }
    const token = match[0]
    pos = TOKEN.lastIndex
    if (/^\s+$/.test(token)) {
      out.push(token)
      continue
    }
    if (NUMBER.test(token)) {
      operands.push({ value: Number(token), at: out.length })
      out.push(token)
      continue
    }
    if (/^[A-Za-z'"*]+$/.test(token)) {
      const replaced = rewriteColor(
        token,
        operands.map((operand) => operand.value),
        spots,
        spotsUsed
      )
      if (token === 'Tf' && lastName) fontsUsed.add(lastName)
      if (replaced !== null && operands.length > 0) {
        out.splice(operands[0].at)
        out.push(replaced)
      } else {
        out.push(token)
      }
      operands = []
      lastName = null
      continue
    }
    if (token.startsWith('/')) lastName = token.slice(1)
    else operands = []
    out.push(token)
  }
  return { text: out.join(''), spotsUsed, fontsUsed }
}
