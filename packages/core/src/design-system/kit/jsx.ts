import type { SceneNode } from '@lawha/scene-graph'

import { flow, jsxText, textDir, type KitTheme } from './theme'
import type { KitWiring } from './wire'

/** The kit's controls, in the order the assets panel lists them. */
export const KIT_KINDS = [
  'button',
  'text-input',
  'textarea',
  'search',
  'number-stepper',
  'select',
  'menu',
  'combobox',
  'multi-select',
  'tabs',
  'accordion',
  'modal',
  'drawer',
  'popover',
  'tooltip',
  'toast',
  'switch',
  'checkbox',
  'radio-group',
  'slider',
  'range-slider',
  'date-picker',
  'date-range-picker',
  'time-picker',
  'file-upload',
  'stepper',
  'pagination',
  'carousel',
  'progress',
  'spinner',
  'rating'
] as const

export type KitKind = (typeof KIT_KINDS)[number]

/** One control of the kit: the component sets it draws, how they are wired, what it inserts. */
export interface KitDefinition {
  kind: KitKind
  /** The main set's name; an inserted instance shows its `insert` variant. */
  name: string
  insert: string
  /** The design JSX of every set the control needs, the main one first. */
  jsx: (theme: KitTheme) => string
  /** Interactions and variables between the variants, once drawn. */
  wire?: (wiring: KitWiring, theme: KitTheme, sets: ReadonlyMap<string, SceneNode>) => void
}

/** Vector paths the kit draws its glyphs with, on a 16 unit square. */
export const GLYPHS = {
  chevronDown: 'M4 6 L8 10 L12 6',
  chevronUp: 'M4 10 L8 6 L12 10',
  chevronLeft: 'M10 4 L6 8 L10 12',
  chevronRight: 'M6 4 L10 8 L6 12',
  check: 'M3.5 8.5 L6.5 11.5 L12.5 4.5',
  minus: 'M4 8 L12 8',
  plus: 'M8 3.5 L8 12.5 M3.5 8 L12.5 8',
  close: 'M4.5 4.5 L11.5 11.5 M11.5 4.5 L4.5 11.5',
  search: 'M7 2.5 A4.5 4.5 0 1 1 7 11.5 A4.5 4.5 0 1 1 7 2.5 M10.5 10.5 L13.5 13.5',
  upload: 'M8 11 L8 3 M5 6 L8 3 L11 6 M3 13 L13 13',
  star: 'M8 1.5 L9.9 5.6 L14.3 6.1 L11 9.1 L11.9 13.5 L8 11.3 L4.1 13.5 L5 9.1 L1.7 6.1 L6.1 5.6 Z'
} as const

/** A glyph as an open stroked vector, or a filled one for the star. */
export function glyph(
  name: keyof typeof GLYPHS,
  color: string,
  options: { size?: number; layer?: string; filled?: boolean } = {}
): string {
  const size = options.size ?? 16
  const paint = options.filled
    ? `bg=${color}`
    : `stroke=${color} strokeWidth={1.6} strokeCap="round" strokeJoin="round"`
  return `<Vector name=${JSON.stringify(options.layer ?? name)} w={${size}} h={${size}} d="${GLYPHS[name]}" ${paint} />`
}

/** A text layer in the kit's font, reading in the theme's direction. */
export function label(
  theme: KitTheme,
  name: string,
  text: string,
  attrs: { size?: number; weight?: number; color?: string; extra?: string } = {}
): string {
  // An explicit alignment, such as a centred title, wins over the reading direction's.
  const direction = attrs.extra?.includes('textAlign') && theme.rtl ? 'dir="rtl"' : textDir(theme)
  return `<Text name=${JSON.stringify(name)} size={${attrs.size ?? 14}} weight={${attrs.weight ?? 400}} font="${theme.font}" color=${attrs.color ?? theme.text} ${direction} ${attrs.extra ?? ''}>${jsxText(text)}</Text>`
}

/** A frame that lays its children out in a row, in the theme's direction. */
export function row(theme: KitTheme, attrs: string, children: string): string {
  return `<Frame flex="row" ${flow(theme)} ${attrs}>${children}</Frame>`
}

/** The attributes every kit component set shares: its variants side by side, wrapping. */
export function setAttrs(name: string): string {
  return `name=${JSON.stringify(name)} flex="row" wrap gap={24} rowGap={24} p={24} w={760} bg="#FFFFFF00"`
}

/** A variant's name from its property values. */
export function variantName(values: Record<string, string>): string {
  return Object.entries(values)
    .map(([key, value]) => `${key}=${value}`)
    .join(', ')
}
