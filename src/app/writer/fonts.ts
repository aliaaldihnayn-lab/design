import type { WriterDefaults } from '@lawha/core/writer'

/**
 * Fonts the document editor offers. Word's common fonts come first, then Arabic faces; the Google
 * Fonts among them are loaded for the editor so a document looks the same wherever it opens.
 */
export const WRITER_GOOGLE_FONTS = [
  'Amiri',
  'Cairo',
  'Tajawal',
  'Noto Naskh Arabic',
  'Noto Kufi Arabic',
  'IBM Plex Sans Arabic',
  'Reem Kufi',
  'Scheherazade New',
  'Great Vibes',
  'Dancing Script',
  'Aref Ruqaa'
] as const

export const WRITER_FONTS = [
  'Calibri',
  'Arial',
  'Times New Roman',
  'Cambria',
  'Georgia',
  'Tahoma',
  'Verdana',
  'Courier New',
  'Traditional Arabic',
  'Simplified Arabic',
  'Sakkal Majalla',
  ...WRITER_GOOGLE_FONTS.filter((font) => !['Great Vibes', 'Dancing Script'].includes(font))
] as const

export const WRITER_FONT_SIZES = [
  8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72
]

/** One Google Fonts stylesheet for every face above; browsers synthesize bold where it lacks one. */
export const WRITER_FONTS_STYLESHEET = `https://fonts.googleapis.com/css2?${WRITER_GOOGLE_FONTS.map(
  (font) => `family=${font.replaceAll(' ', '+')}`
).join('&')}&display=swap`

/** A family name as a CSS string. */
const cssFamily = (family: string) => `"${family.replaceAll(/["\\]/g, '')}"`

/**
 * CSS for a document's default text, as Word shows unstyled text: its Latin face, then its
 * complex-script face, which the browser falls back to for the Arabic letters the Latin face
 * lacks, then `fallback`. Empty where the document sets no default.
 */
export function documentFontStyle(
  defaults: WriterDefaults | null | undefined,
  fallback: string
): { fontFamily?: string; fontSize?: string } {
  const families = [defaults?.fontFamily, defaults?.fontFamilyComplex].filter(
    (family): family is string => Boolean(family)
  )
  const style: { fontFamily?: string; fontSize?: string } = {}
  if (families.length) style.fontFamily = [...families.map(cssFamily), fallback].join(', ')
  if (defaults?.fontSize) style.fontSize = `${defaults.fontSize}pt`
  return style
}
