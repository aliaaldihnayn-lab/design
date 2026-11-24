import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

import { SELECTION_COLOR } from '@lawha/core/constants'
import { contrastRatio, parseColor, rgbaToOkHCL } from '@lawha/scene-graph/color'

import {
  ACCENT_LIGHTNESS_RANGE,
  ACCENT_TOKENS,
  accentBaseColor,
  DEFAULT_ACCENT,
  deriveAccentPalette,
  type AccentTheme
} from '@/app/shell/accent/palette'
import { ACCENT_PRESETS } from '@/app/shell/accent/schema'

const THEMES: AccentTheme[] = ['dark', 'light']

function palette(color: string, theme: AccentTheme) {
  return deriveAccentPalette(accentBaseColor({ kind: 'custom', color }), theme)
}

/** The custom properties a block of `src/theme/tokens.css` sets, by name, in upper-case hex. */
function stylesheetTokens(theme: AccentTheme): Record<string, string> {
  const css = readFileSync(new URL('../../../../src/theme/tokens.css', import.meta.url), 'utf8')
  const block =
    theme === 'dark'
      ? /@theme \{([\s\S]*?)\n\}/.exec(css)?.[1]
      : /html\[data-theme='light'\] \{([\s\S]*?)\n\}/.exec(css)?.[1]
  if (!block) throw new Error(`tokens.css has no ${theme} block`)
  return Object.fromEntries(
    [...block.matchAll(/(--color-[\w-]+):\s*(#[0-9a-fA-F]{6});/g)].map(([, name, value]) => [
      name,
      value.toUpperCase()
    ])
  )
}

describe('deriveAccentPalette', () => {
  test('the default Lawha accent reproduces the stylesheet, so the page matches before boot', () => {
    expect(DEFAULT_ACCENT).toEqual({ kind: 'preset', preset: 'lawha' })
    const dark = stylesheetTokens('dark')
    const light = { ...dark, ...stylesheetTokens('light') }
    for (const [theme, sheet] of [
      ['dark', dark],
      ['light', light]
    ] as const) {
      const { tokens } = deriveAccentPalette(accentBaseColor(DEFAULT_ACCENT), theme)
      for (const token of ACCENT_TOKENS)
        expect([token, sheet[token]]).toEqual([token, tokens[token]])
    }
  })

  test('the Lawha accent takes the brand peach hue and keeps AA text in both themes', () => {
    const peach = rgbaToOkHCL(parseColor('#FFE9D7')).h
    const white = parseColor('#FFFFFF')
    for (const theme of THEMES) {
      const { tokens, selection } = deriveAccentPalette(accentBaseColor(DEFAULT_ACCENT), theme)
      expect(Math.abs(rgbaToOkHCL(parseColor(tokens['--color-accent'])).h - peach)).toBeLessThan(20)
      expect(tokens['--color-on-accent']).toBe('#FFFFFF')
      expect(contrastRatio(white, parseColor(tokens['--color-accent']))).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(white, selection.color)).toBeGreaterThanOrEqual(3)
      // Primary is link and label text on the panel, and focus rings must reach 3:1 against it.
      const panel = parseColor(theme === 'dark' ? '#2A2A2A' : '#FFFFFF')
      expect(contrastRatio(parseColor(tokens['--color-primary']), panel)).toBeGreaterThanOrEqual(
        4.5
      )
      expect(
        contrastRatio(parseColor(tokens['--color-panel-focus']), panel)
      ).toBeGreaterThanOrEqual(3)
    }
  })

  test('hover and pressed steps raise text contrast, and subtle tints keep primary text readable', () => {
    for (const preset of ACCENT_PRESETS) {
      for (const theme of THEMES) {
        const { tokens } = deriveAccentPalette(accentBaseColor({ kind: 'preset', preset }), theme)
        const ratio = (text: string, surface: string) =>
          contrastRatio(parseColor(text), parseColor(surface))
        for (const [text, base, hover, pressed] of [
          ['--color-on-accent', '--color-accent', '--color-accent-hover', '--color-accent-pressed'],
          [
            '--color-on-primary',
            '--color-primary',
            '--color-primary-hover',
            '--color-primary-pressed'
          ]
        ] as const) {
          const rest = ratio(tokens[text], tokens[base])
          expect(rest).toBeGreaterThanOrEqual(4.5)
          expect(ratio(tokens[text], tokens[hover])).toBeGreaterThan(rest)
          expect(ratio(tokens[text], tokens[pressed])).toBeGreaterThan(
            ratio(tokens[text], tokens[hover])
          )
        }
        // The tint never costs primary text its AA contrast, nor more than the bare panel gives.
        const panel = theme === 'dark' ? '#2A2A2A' : '#FFFFFF'
        expect(
          ratio(tokens['--color-primary'], tokens['--color-accent-subtle'])
        ).toBeGreaterThanOrEqual(Math.min(4.5, ratio(tokens['--color-primary'], panel)))
      }
    }
  })

  test('the blue preset reproduces the tokens the accent family was designed around', () => {
    const blue = accentBaseColor({ kind: 'preset', preset: 'blue' })
    expect(deriveAccentPalette(blue, 'dark').tokens).toEqual({
      '--color-accent': '#2563EB',
      '--color-panel-focus': '#3B82F6',
      '--color-panel-selected': '#2F6FDD',
      '--color-panel-selected-muted': '#353B46',
      '--color-primary': '#60A5FA',
      '--color-on-accent': '#FFFFFF',
      '--color-on-primary': '#1F2328',
      '--color-accent-hover': '#1956DD',
      '--color-accent-pressed': '#0B48CF',
      '--color-accent-subtle': '#293858',
      '--color-primary-hover': '#6CB2FF',
      '--color-primary-pressed': '#81BFFF'
    })
    expect(deriveAccentPalette(blue, 'light').tokens).toEqual({
      '--color-accent': '#2563EB',
      '--color-panel-focus': '#2563EB',
      '--color-panel-selected': '#2563EB',
      '--color-panel-selected-muted': '#E5E7EB',
      '--color-primary': '#1D4ED8',
      '--color-on-accent': '#FFFFFF',
      '--color-on-primary': '#FFFFFF',
      '--color-accent-hover': '#1956DD',
      '--color-accent-pressed': '#0B48CF',
      '--color-accent-subtle': '#E5ECFD',
      '--color-primary-hover': '#1340CA',
      '--color-primary-pressed': '#0832BC'
    })
    const selection = deriveAccentPalette(blue, 'dark').selection
    expect(selection.color.r).toBeCloseTo(SELECTION_COLOR.r, 2)
    expect(selection.color.g).toBeCloseTo(SELECTION_COLOR.g, 2)
    expect(selection.color.b).toBeCloseTo(SELECTION_COLOR.b, 2)
    expect(selection.foreground).toEqual(parseColor('#FFFFFF'))
  })

  test('every preset keeps white text readable on its accent surfaces in both themes', () => {
    for (const preset of ACCENT_PRESETS) {
      for (const theme of THEMES) {
        const { tokens } = deriveAccentPalette(accentBaseColor({ kind: 'preset', preset }), theme)
        expect(tokens['--color-on-accent']).toBe('#FFFFFF')
        const white = parseColor('#FFFFFF')
        expect(contrastRatio(white, parseColor(tokens['--color-accent']))).toBeGreaterThan(4.5)
      }
    }
  })

  test('a light custom accent switches its text to dark ink, on the canvas too', () => {
    for (const theme of THEMES) {
      const { tokens, selection } = palette('#FFEE00', theme)
      expect(tokens['--color-on-accent']).toBe('#1F2328')
      expect(tokens['--color-on-primary']).toBe('#1F2328')
      expect(selection.foreground).toEqual(parseColor('#1F2328'))
    }
  })

  test('pulls near-black and near-white picks into a visible lightness', () => {
    for (const color of ['#000000', '#FFFFFF']) {
      const lightness = rgbaToOkHCL(parseColor(palette(color, 'dark').tokens['--color-accent'])).l
      expect(lightness).toBeGreaterThan(ACCENT_LIGHTNESS_RANGE.min - 0.05)
      expect(lightness).toBeLessThan(ACCENT_LIGHTNESS_RANGE.max + 0.05)
    }
  })

  test('moves a custom accent until its text reaches AA contrast on accent and primary surfaces', () => {
    for (const color of ['#808080', '#00A0A0', '#FF4FA0']) {
      for (const theme of THEMES) {
        const { tokens } = palette(color, theme)
        const onAccent = parseColor(tokens['--color-on-accent'])
        const onPrimary = parseColor(tokens['--color-on-primary'])
        for (const surface of ['--color-accent', '--color-panel-selected'] as const) {
          expect(contrastRatio(onAccent, parseColor(tokens[surface]))).toBeGreaterThanOrEqual(4.5)
        }
        expect(
          contrastRatio(onPrimary, parseColor(tokens['--color-primary']))
        ).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  test('the unfocused selection tint keeps the panel lightness and takes the accent hue', () => {
    const reference = rgbaToOkHCL(parseColor('#353B46'))
    const tint = rgbaToOkHCL(
      parseColor(palette('#A16207', 'dark').tokens['--color-panel-selected-muted'])
    )
    expect(tint.l).toBeCloseTo(reference.l, 2)
    const accentHue = rgbaToOkHCL(parseColor('#A16207')).h
    expect(Math.abs(tint.h - accentHue)).toBeLessThan(10)
  })

  test('the canvas selection follows the accent hue but not the interface theme', () => {
    const dark = palette('#15803D', 'dark').selection
    expect(palette('#15803D', 'light').selection).toEqual(dark)
    expect(dark.color.g).toBeGreaterThan(dark.color.b)
    expect(dark.color.g).toBeGreaterThan(dark.color.r)
  })
})
