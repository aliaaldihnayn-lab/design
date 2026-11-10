import { inspectCompose } from './compose'
import { inspectCSS } from './css'
import type { InspectSpec } from './spec'
import { inspectSwiftUI } from './swiftui'

/** The languages the inspect panel shows a layer in, as Figma's Dev Mode does. */
export const INSPECT_LANGUAGES = ['css', 'swiftui', 'compose'] as const
export type InspectLanguage = (typeof INSPECT_LANGUAGES)[number]

const GENERATORS: Record<InspectLanguage, (spec: InspectSpec) => string> = {
  css: inspectCSS,
  swiftui: inspectSwiftUI,
  compose: inspectCompose
}

/** The layer's code in one language. */
export function inspectCode(spec: InspectSpec, language: InspectLanguage): string {
  return GENERATORS[language](spec)
}
