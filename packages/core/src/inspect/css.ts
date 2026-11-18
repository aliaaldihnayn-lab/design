import type { InspectSpec } from './spec'

export const px = (value: number) => `${Math.round(value * 100) / 100}px`
export const num = (value: number) => `${Math.round(value * 100) / 100}`

/**
 * The layer as CSS declarations, one per line, as Dev Mode lists them: the same CSS the HTML,
 * JSX and Tailwind export writes, with bound values through their custom properties.
 */
export function inspectCSS(spec: InspectSpec): string {
  return spec.css.map(([property, value]) => `${property}: ${value};`).join('\n')
}
