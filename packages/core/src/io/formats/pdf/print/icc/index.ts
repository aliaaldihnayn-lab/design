import { toUint8Array } from 'js-base64'

import type { PDFOutputIntentId } from '#core/io/formats/pdf/print/color'

import { parseICCProfile, type ICCRenderingIntent } from './profile'
import { createProfileTransform, type RGBToCMYK } from './transform'

export { parseICCProfile, type ICCProfile, type ICCRenderingIntent } from './profile'
export { createProfileTransform, profileColor, type RGBToCMYK } from './transform'

/** A press profile ready to convert with and embed as the output intent's profile. */
export interface PressProfile {
  bytes: Uint8Array
  description: string
  toCMYK: RGBToCMYK
}

/** Reads the bundled FOGRA39 profile, split out so only print export downloads it. */
async function bundledFOGRA39(): Promise<Uint8Array> {
  const { FOGRA39L_COATED_ICC } = await import('./fogra39')
  return toUint8Array(FOGRA39L_COATED_ICC)
}

/** The press conditions Lawha carries a profile for. */
export const BUNDLED_PROFILE_INTENTS: readonly PDFOutputIntentId[] = ['FOGRA39']

export type PressProfileResult =
  | { profile: PressProfile }
  | { profile: null; reason: 'unreadable' | 'not-cmyk' | 'none-bundled' }

/**
 * The profile to convert colours with: the one given, else the bundled one for the press
 * condition. A given profile that is not a CMYK output profile with tables this can read, or a
 * condition without a bundled profile, has none, and says why.
 */
export async function loadPressProfile(
  intent: PDFOutputIntentId,
  given?: Uint8Array,
  renderingIntent: ICCRenderingIntent = 'perceptual'
): Promise<PressProfileResult> {
  const bytes =
    given ?? (BUNDLED_PROFILE_INTENTS.includes(intent) ? await bundledFOGRA39() : undefined)
  if (!bytes) return { profile: null, reason: 'none-bundled' }
  const parsed = parseICCProfile(bytes)
  if (!parsed) return { profile: null, reason: 'unreadable' }
  const toCMYK = createProfileTransform(parsed, renderingIntent)
  if (!toCMYK) return { profile: null, reason: 'not-cmyk' }
  return { profile: { bytes, description: parsed.description, toCMYK } }
}
