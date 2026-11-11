import { inspectAndroidXML } from './android'
import { inspectCompose } from './compose'
import { inspectCSS } from './css'
import type { InspectSpec } from './spec'
import { inspectSwiftUI } from './swiftui'
import { inspectUIKit } from './uikit'

/** The languages the inspect panel shows a layer in, as Figma's Dev Mode does. */
export const INSPECT_LANGUAGES = ['css', 'swiftui', 'uikit', 'compose', 'android-xml'] as const
export type InspectLanguage = (typeof INSPECT_LANGUAGES)[number]

const GENERATORS: Record<InspectLanguage, (spec: InspectSpec) => string> = {
  css: inspectCSS,
  swiftui: inspectSwiftUI,
  uikit: inspectUIKit,
  compose: inspectCompose,
  'android-xml': inspectAndroidXML
}

/** The layer's code in one language. */
export function inspectCode(spec: InspectSpec, language: InspectLanguage): string {
  return GENERATORS[language](spec)
}
