import type { Matrix, PDFFontInfo } from './text'

/**
 * A PDF font's face from its PostScript name, as PDFs name the fonts they embed:
 * `ABCDEF+OpenSans-SemiBoldItalic` is Open Sans at weight 600, italic.
 */
export interface PDFFontFace {
  family: string
  weight: number
  italic: boolean
}

/** Style words in PostScript names, longest first so `ExtraBold` is not read as `Bold`. */
const WEIGHTS: [RegExp, number][] = [
  [/(?:extra|ultra)\s*light/i, 200],
  [/(?:semi|demi)\s*bold/i, 600],
  [/(?:extra|ultra)\s*bold/i, 800],
  [/hairline|thin/i, 100],
  [/light/i, 300],
  [/medium/i, 500],
  [/black|heavy/i, 900],
  [/bold/i, 700]
]

/** Fonts PDFs name by a PostScript name unlike their family's. */
const KNOWN_FAMILIES: Partial<Record<string, string>> = {
  ArialMT: 'Arial',
  TimesNewRomanPSMT: 'Times New Roman',
  TimesNewRomanPS: 'Times New Roman',
  'Times-Roman': 'Times',
  CourierNewPSMT: 'Courier New',
  CourierNewPS: 'Courier New'
}

/** `OpenSans` as `Open Sans`; names with spaces, digits runs, or all caps are left as they are. */
function spaced(family: string): string {
  if (/\s/.test(family)) return family
  return family.replace(/([a-z])([A-Z])/g, '$1 $2')
}

export function parsePDFFontName(
  postScriptName: string,
  flags: { bold?: boolean; black?: boolean; italic?: boolean } = {}
): PDFFontFace {
  const name = postScriptName.replace(/^[A-Z]{6}\+/, '')
  const known = KNOWN_FAMILIES[name]
  const [namePart, ...styleParts] = name.split(/[-,]/)
  // Without a separator the style may close the name itself: `FreeSerifBold`, `ArialBoldItalic`.
  const glued =
    styleParts.length === 0 && !known
      ? /^(.*?[a-z])((?:(?:Semi|Demi|Extra|Ultra)?(?:Bold|Light)|Medium|Black|Heavy|Thin|Italic|Oblique)+)$/.exec(
          namePart
        )
      : null
  const familyPart = glued ? glued[1] : namePart
  const style = glued ? glued[2] : styleParts.join(' ')
  // A variable font's PostScript name often carries `Variable` or `VF`: `InterVariable` is Inter.
  const family =
    known ??
    KNOWN_FAMILIES[familyPart] ??
    spaced(familyPart.replace(/(?:PS)?MT$/, '').replace(/(?<=[a-z])(?:Variable|VF)$/, '')).trim()
  let weight = WEIGHTS.find(([pattern]) => pattern.test(style))?.[1] ?? 400
  if (weight === 400 && flags.black) weight = 900
  else if (weight === 400 && flags.bold) weight = 700
  return {
    family: family || name,
    weight,
    italic: /italic|oblique/i.test(style) || (flags.italic ?? false)
  }
}

/** The face and metrics pdf.js loaded a font with. */
export function fontInfo(font: unknown): PDFFontInfo {
  const info: PDFFontInfo = {
    face: null,
    fallback: 'sans-serif',
    fontMatrix: [0.001, 0, 0, 0.001, 0, 0],
    vertical: false
  }
  if (typeof font !== 'object' || font === null) return info
  const get = (key: string): unknown => Reflect.get(font, key)
  const fallback = get('fallbackName')
  if (typeof fallback === 'string' && fallback) info.fallback = fallback
  const matrix = get('fontMatrix')
  if (Array.isArray(matrix) && matrix.length === 6 && matrix[0] && matrix[3])
    info.fontMatrix = matrix as Matrix
  info.vertical = get('vertical') === true
  const name = get('name')
  if (typeof name === 'string' && name) {
    info.face = parsePDFFontName(name, {
      bold: get('bold') === true,
      black: get('black') === true,
      italic: get('italic') === true
    })
  }
  return info
}
