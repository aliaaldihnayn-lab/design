/**
 * What a print export reports: issues that keep the file from declaring PDF/X, and notes on what
 * it changed or could not do as well as asked, each with a code front ends translate and an
 * English message for the CLI, MCP and logs.
 */

export const PRINT_ISSUE_CODES = [
  'compressed-content',
  'gradient-colours',
  'image-not-converted',
  'standard-font',
  'font-not-embedded',
  'transparency',
  'rgb-remaining'
] as const

export const PRINT_NOTE_CODES = [
  'transparency-flattened',
  'no-press-profile',
  'profile-unreadable',
  'bleed-in-artwork'
] as const

export type PrintIssueCode = (typeof PRINT_ISSUE_CODES)[number] | (typeof PRINT_NOTE_CODES)[number]

export interface PrintIssue {
  code: PrintIssueCode
  /** What the issue is about, such as a font's name, a press condition, or a count. */
  subject?: string
  message: string
}

const MESSAGES: Record<PrintIssueCode, (subject: string) => string> = {
  'compressed-content': () => 'A page uses compressed content this export cannot read',
  'gradient-colours': () => 'A gradient uses colours this export cannot convert',
  'image-not-converted': () => 'An image could not be converted to CMYK',
  'standard-font': (font) => `Text uses ${font}, a font the file does not embed`,
  'font-not-embedded': (font) => `The font ${font} is not embedded`,
  transparency: () => 'Transparency remains that could not be flattened, so it is not PDF/X-1a',
  'rgb-remaining': () => 'Some colours are still RGB',
  'transparency-flattened': (count) =>
    `${count} transparent area(s) were flattened into images at 300 ppi for PDF/X-1a`,
  'no-press-profile': (condition) =>
    `No ICC profile for ${condition} is bundled; colours were converted without one`,
  'profile-unreadable': () =>
    'The ICC profile given is not a CMYK output profile this export can read; colours were converted without it',
  'bleed-in-artwork': () =>
    'The artwork already includes bleed past its trim marks, so no bleed was added'
}

export function printIssue(code: PrintIssueCode, subject?: string): PrintIssue {
  return {
    code,
    ...(subject === undefined ? {} : { subject }),
    message: MESSAGES[code](subject ?? '')
  }
}
