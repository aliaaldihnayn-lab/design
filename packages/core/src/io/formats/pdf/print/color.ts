import { clamp } from 'es-toolkit'

import type { Color } from '@lawha/scene-graph/primitives'

/** Cyan, magenta, yellow, black, each 0–1. */
export type CMYK = readonly [number, number, number, number]

/**
 * Device RGB to CMYK with full black generation: black takes the grey part, the inks the rest.
 * It is the conversion PDF readers use for DeviceRGB, not a press profile's.
 */
export function rgbToCMYK(r: number, g: number, b: number): CMYK {
  const k = 1 - Math.max(r, g, b)
  if (k >= 1 - 1e-6) return [0, 0, 0, 1]
  const rest = 1 - k
  const ink = (v: number) => clamp((1 - v - k) / rest, 0, 1)
  return [ink(r), ink(g), ink(b), clamp(k, 0, 1)]
}

/** A device RGB colour (each 0–1) as CMYK, by a press profile or the device formula. */
export type ToCMYK = (r: number, g: number, b: number) => CMYK

/**
 * The conversion vector paint goes through: pure neutrals, black text above all, print in black
 * ink alone, as prepress converts them, so no plate misregistration fringes them; other colours
 * through `toCMYK`.
 */
export function vectorCMYK(toCMYK: ToCMYK): ToCMYK {
  return (r, g, b) => {
    const neutral = Math.abs(r - g) < 1e-6 && Math.abs(g - b) < 1e-6
    return neutral ? [0, 0, 0, clamp(1 - r, 0, 1)] : toCMYK(r, g, b)
  }
}

/** FOGRA39's total area coverage: the four inks may add up to 330% at most. */
export const DEFAULT_INK_LIMIT = 3.3

/**
 * A colour within `limit` total ink: grey component replacement first moves the part of cyan,
 * magenta and yellow that only makes grey into black, which prints the same with less ink, and
 * under colour removal then takes what is still over the limit evenly from the three colours.
 */
export function limitInk(cmyk: CMYK, limit: number): CMYK {
  const [c, m, y, k] = cmyk
  const excess = c + m + y + k - limit
  if (excess <= 1e-6) return cmyk
  // Replacing r of each colour with r of black saves 2r of ink.
  const replaced = Math.max(0, Math.min(c, m, y, 1 - k, excess / 2))
  let [c2, m2, y2] = [c - replaced, m - replaced, y - replaced]
  const k2 = k + replaced
  const over = c2 + m2 + y2 + k2 - limit
  if (over > 1e-6) {
    const colours = c2 + m2 + y2
    const keep = colours > 0 ? Math.max(0, (colours - over) / colours) : 0
    c2 *= keep
    m2 *= keep
    y2 *= keep
  }
  return [c2, m2, y2, k2]
}

/** A conversion whose every colour stays within `limit` total ink. */
export function inkLimited(toCMYK: ToCMYK, limit: number): ToCMYK {
  return (r, g, b) => limitInk(toCMYK(r, g, b), limit)
}

/** A colour printed in an ink of its own, such as a Pantone colour or a cutter's CutContour. */
export interface PDFSpotColor {
  /** The ink's name, as the press or cutter knows it. */
  name: string
  /** The colour layers paint with to mean this ink. */
  color: Pick<Color, 'r' | 'g' | 'b'>
  /** What the ink looks like in process colours; from `color` without one. */
  cmyk?: CMYK
}

/**
 * The print-shop convention die-lines follow: the cut in 100% magenta named CutContour, folds in
 * cyan named Crease, which cutters and RIPs read as inks of their own.
 */
export const DIELINE_SPOTS = {
  cut: { name: 'CutContour', color: { r: 0.925, g: 0, b: 0.549 }, cmyk: [0, 1, 0, 0] },
  crease: { name: 'Crease', color: { r: 0, g: 0.682, b: 0.937 }, cmyk: [1, 0, 0, 0] }
} as const satisfies Record<string, PDFSpotColor>

/** Registration: crop marks print on every plate. */
export const REGISTRATION_SPOT: PDFSpotColor = {
  name: 'All',
  color: { r: 1 / 255, g: 2 / 255, b: 3 / 255 },
  cmyk: [1, 1, 1, 1]
}

/** Print conditions a PDF/X file can name by their registered characterisation. */
export const PDF_OUTPUT_INTENTS = {
  FOGRA39: { identifier: 'FOGRA39', info: 'Coated FOGRA39 (ISO 12647-2:2004)' },
  FOGRA51: { identifier: 'FOGRA51', info: 'PSO Coated v3 (ISO 12647-2:2013)' },
  GRACoL2013: { identifier: 'CGATS21_CRPC6', info: 'GRACoL 2013 coated (CGATS 21-2 CRPC6)' },
  SWOP: { identifier: 'CGATS TR 001', info: 'U.S. Web Coated (SWOP) v2' }
} as const

export type PDFOutputIntentId = keyof typeof PDF_OUTPUT_INTENTS

/** jsPDF writes stroke colours with two decimals, so a colour matches within half a step. */
const MATCH_TOLERANCE = 0.0051

export function matchSpot(spots: readonly PDFSpotColor[], r: number, g: number, b: number): number {
  return spots.findIndex(
    (spot) =>
      Math.abs(spot.color.r - r) <= MATCH_TOLERANCE &&
      Math.abs(spot.color.g - g) <= MATCH_TOLERANCE &&
      Math.abs(spot.color.b - b) <= MATCH_TOLERANCE
  )
}

export function spotCMYK(spot: PDFSpotColor, toCMYK: ToCMYK = rgbToCMYK): CMYK {
  return spot.cmyk ?? toCMYK(spot.color.r, spot.color.g, spot.color.b)
}

/** A PDF name with the characters a name cannot hold written as `#xx`. */
export function pdfName(name: string): string {
  let out = ''
  for (const char of new TextEncoder().encode(name)) {
    const safe = char > 32 && char < 127 && !'#()<>[]{}/%'.includes(String.fromCharCode(char))
    out += safe ? String.fromCharCode(char) : `#${char.toString(16).padStart(2, '0')}`
  }
  return `/${out}`
}

/** A PDF text string: literal when ASCII, else UTF-16 with its byte order mark, in hex. */
export function pdfString(text: string): string {
  if (/^[\x20-\x7e]*$/.test(text)) return `(${text.replace(/[\\()]/g, (char) => `\\${char}`)})`
  let hex = 'FEFF'
  for (let i = 0; i < text.length; i++) hex += text.charCodeAt(i).toString(16).padStart(4, '0')
  return `<${hex.toUpperCase()}>`
}

export function formatNumber(value: number): string {
  const rounded = Math.round(value * 1000) / 1000
  return Object.is(rounded, -0) ? '0' : String(rounded)
}
