import { maxBy } from 'es-toolkit'

import type { SelectionTheme } from '@lawha/core/canvas'
import { SELECTION_COLOR } from '@lawha/core/constants'
import {
  colorToHex,
  contrastRatio,
  okhclToRGBA,
  parseColor,
  rgbaToOkHCL
} from '@lawha/scene-graph/color'
import { WHITE } from '@lawha/scene-graph/constants'
import type { Color } from '@lawha/scene-graph/primitives'

import type { AccentPreference, AccentPreset } from './schema'

export const DEFAULT_ACCENT: Readonly<AccentPreference> = { kind: 'preset', preset: 'lawha' }

/** Base colors dark enough that white text reads on every accent surface in both themes. */
export const ACCENT_PRESET_COLORS: Readonly<Record<AccentPreset, string>> = {
  /**
   * Lawha's own accent: the brand peach (#FFE9D7, OkLCH hue 62) carried down to a burnt orange
   * between that hue and the more saturated orange preset, the darkest step white text reads on.
   */
  lawha: '#B84D00',
  blue: '#2563EB',
  purple: '#9333EA',
  pink: '#BE185D',
  red: '#B91C1C',
  orange: '#C2410C',
  yellow: '#A16207',
  green: '#15803D',
  graphite: '#52525B'
}

export type AccentTheme = 'dark' | 'light'

/** The interface tokens an accent recolors, by CSS custom property. */
export const ACCENT_TOKENS = [
  '--color-accent',
  '--color-panel-focus',
  '--color-panel-selected',
  '--color-panel-selected-muted',
  '--color-primary',
  '--color-on-accent',
  '--color-on-primary',
  '--color-accent-hover',
  '--color-accent-pressed',
  '--color-accent-subtle',
  '--color-primary-hover',
  '--color-primary-pressed'
] as const
export type AccentToken = (typeof ACCENT_TOKENS)[number]

type DerivedToken = Exclude<
  AccentToken,
  | '--color-on-accent'
  | '--color-on-primary'
  | '--color-accent-hover'
  | '--color-accent-pressed'
  | '--color-accent-subtle'
  | '--color-primary-hover'
  | '--color-primary-pressed'
>

/** OkLCH lightness a hovered surface moves by; a pressed one moves twice as far. */
export const ACCENT_STATE_STEP = 0.04

/** The panels a subtle accent tint is mixed over, `--color-panel` in each theme. */
const PANELS: Readonly<Record<AccentTheme, string>> = { dark: '#2A2A2A', light: '#FFFFFF' }

/** How much of the accent a subtle tint holds over the panel. */
const SUBTLE_SHARE: Readonly<Record<AccentTheme, number>> = { dark: 0.24, light: 0.12 }

/**
 * The blue family the accent tokens were designed around. Every accent keeps each token's
 * lightness, chroma and hue relation to the base, so a new accent looks like the default one.
 */
const REFERENCE_BASE = parseColor(ACCENT_PRESET_COLORS.blue)
const REFERENCE_TOKENS: Readonly<Record<AccentTheme, Readonly<Record<DerivedToken, string>>>> = {
  dark: {
    '--color-accent': '#2563EB',
    '--color-panel-focus': '#3B82F6',
    '--color-panel-selected': '#2F6FDD',
    '--color-panel-selected-muted': '#353B46',
    '--color-primary': '#60A5FA'
  },
  light: {
    '--color-accent': '#2563EB',
    '--color-panel-focus': '#2563EB',
    '--color-panel-selected': '#2563EB',
    '--color-panel-selected-muted': '#E5E7EB',
    '--color-primary': '#1D4ED8'
  }
}

/** Lightness band a base is held in, so a near-black or near-white pick still shows its controls. */
export const ACCENT_LIGHTNESS_RANGE = { min: 0.4, max: 0.75 } as const

/** WCAG AA contrast for normal text, which every accent's text keeps against its surface. */
export const ACCENT_TEXT_CONTRAST = 4.5

/** Lightness steps tried, nearest first, when a color's text would fall short of that contrast. */
const LIGHTNESS_SHIFTS = Array.from({ length: 61 }, (_, index) =>
  index % 2 === 0 ? index / 2 / 200 : -(index + 1) / 2 / 200
)

/** The interface's dark text, `--color-inverted` in the dark theme and `--color-surface` in light. */
const INK = parseColor('#1F2328')

export interface AccentPalette {
  /** Hex values for each recolored CSS custom property. */
  tokens: Record<AccentToken, string>
  /** Canvas selection chrome, the same in both themes, with the interface's accent text color. */
  selection: SelectionTheme
}

export function accentBaseColor(preference: AccentPreference): Color {
  if (preference.kind === 'preset') return parseColor(ACCENT_PRESET_COLORS[preference.preset])
  return parseColor(preference.color)
}

function clampLightness(lightness: number): number {
  return Math.min(ACCENT_LIGHTNESS_RANGE.max, Math.max(ACCENT_LIGHTNESS_RANGE.min, lightness))
}

/**
 * Moves a reference token the way `base` differs from the default blue, in OkLCH, plus `shift`
 * in lightness. A tint keeps its own lightness, since it is a shade of the panel behind it rather
 * than of the accent.
 */
function relateTo(base: Color, shift: number): (reference: Color, tint?: boolean) => Color {
  const from = rgbaToOkHCL(REFERENCE_BASE)
  const to = rgbaToOkHCL(base)
  const lightness = clampLightness(to.l) - from.l + shift
  const chroma = to.c / from.c
  const hue = to.h - from.h
  return (reference, tint = false) => {
    const color = rgbaToOkHCL(reference)
    const related = okhclToRGBA({
      l: tint ? color.l : color.l + lightness,
      c: color.c * chroma,
      h: color.h + hue,
      a: 1
    })
    // Rounded to the hex the stylesheet receives, so contrast is checked on what is drawn.
    return parseColor(colorToHex(related))
  }
}

function worstContrast(text: Color, surfaces: Color[]): number {
  return Math.min(...surfaces.map((surface) => contrastRatio(text, surface)))
}

/** White or ink, whichever reads worst-case better on every surface the text sits on. */
function accentForeground(surfaces: Color[]): Color {
  return maxBy([WHITE, INK], (text) => worstContrast(text, surfaces))
}

function surfaces(base: Color, theme: AccentTheme, shift: number) {
  const relate = relateTo(base, shift)
  const reference = REFERENCE_TOKENS[theme]
  return {
    relate,
    reference,
    accent: relate(parseColor(reference['--color-accent'])),
    selected: relate(parseColor(reference['--color-panel-selected'])),
    primary: relate(parseColor(reference['--color-primary']))
  }
}

/** How readable a family's text is: the lower of its accent and primary text contrasts. */
function textContrast({ accent, selected, primary }: ReturnType<typeof surfaces>): number {
  const accentSurfaces = [accent, selected]
  return Math.min(
    worstContrast(accentForeground(accentSurfaces), accentSurfaces),
    worstContrast(accentForeground([primary]), [primary])
  )
}

/** `color` moved by `delta` in OkLCH lightness, as the hex the stylesheet receives. */
function shiftLightness(color: Color, delta: number): Color {
  const okhcl = rgbaToOkHCL(color)
  return parseColor(colorToHex(okhclToRGBA({ ...okhcl, l: okhcl.l + delta, a: 1 })))
}

/**
 * `color` laid over the theme's panel and flattened to an opaque tint, at the largest share up to
 * {@link SUBTLE_SHARE} that keeps `text` at {@link ACCENT_TEXT_CONTRAST} on it.
 */
function tint(color: Color, theme: AccentTheme, text: Color): Color {
  const panel = parseColor(PANELS[theme])
  for (let share = SUBTLE_SHARE[theme]; share > 0; share -= 0.02) {
    const mix = (a: number, b: number) => a * share + b * (1 - share)
    const result = parseColor(
      colorToHex({
        r: mix(color.r, panel.r),
        g: mix(color.g, panel.g),
        b: mix(color.b, panel.b),
        a: 1
      })
    )
    if (contrastRatio(text, result) >= ACCENT_TEXT_CONTRAST) return result
  }
  return panel
}

/**
 * Hover and pressed steps for a surface with `foreground` text: darker under white text, lighter
 * under dark ink, so the text gains contrast as the surface responds.
 */
function stateSteps(surface: Color, foreground: Color): [Color, Color] {
  const direction = foreground === WHITE ? -1 : 1
  return [
    shiftLightness(surface, direction * ACCENT_STATE_STEP),
    shiftLightness(surface, direction * ACCENT_STATE_STEP * 2)
  ]
}

/**
 * The accent family for `theme`, derived from one base color. When its text would fall short of
 * {@link ACCENT_TEXT_CONTRAST}, the family moves by the smallest lightness shift that reaches it.
 */
export function deriveAccentPalette(base: Color, theme: AccentTheme): AccentPalette {
  const families = LIGHTNESS_SHIFTS.map((shift) => surfaces(base, theme, shift))
  const family =
    families.find((candidate) => textContrast(candidate) >= ACCENT_TEXT_CONTRAST) ??
    maxBy(families, textContrast) ??
    surfaces(base, theme, 0)
  const { relate, reference, accent, selected, primary } = family
  const foreground = accentForeground([accent, selected])
  const primaryForeground = accentForeground([primary])
  const [accentHover, accentPressed] = stateSteps(accent, foreground)
  const [primaryHover, primaryPressed] = stateSteps(primary, primaryForeground)
  return {
    tokens: {
      '--color-accent': colorToHex(accent),
      '--color-panel-focus': colorToHex(relate(parseColor(reference['--color-panel-focus']))),
      '--color-panel-selected': colorToHex(selected),
      '--color-panel-selected-muted': colorToHex(
        relate(parseColor(reference['--color-panel-selected-muted']), true)
      ),
      '--color-primary': colorToHex(primary),
      '--color-on-accent': colorToHex(foreground),
      '--color-on-primary': colorToHex(primaryForeground),
      '--color-accent-hover': colorToHex(accentHover),
      '--color-accent-pressed': colorToHex(accentPressed),
      '--color-accent-subtle': colorToHex(tint(accent, theme, primary)),
      '--color-primary-hover': colorToHex(primaryHover),
      '--color-primary-pressed': colorToHex(primaryPressed)
    },
    selection: { color: relate(SELECTION_COLOR), foreground }
  }
}
