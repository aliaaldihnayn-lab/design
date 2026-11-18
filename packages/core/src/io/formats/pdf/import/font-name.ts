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
  const [familyPart, ...styleParts] = name.split(/[-,]/)
  const style = styleParts.join(' ')
  const family =
    known ?? KNOWN_FAMILIES[familyPart] ?? spaced(familyPart.replace(/(?:PS)?MT$/, '')).trim()
  let weight = WEIGHTS.find(([pattern]) => pattern.test(style))?.[1] ?? 400
  if (weight === 400 && flags.black) weight = 900
  else if (weight === 400 && flags.bold) weight = 700
  return {
    family: family || name,
    weight,
    italic: /italic|oblique/i.test(style) || (flags.italic ?? false)
  }
}
