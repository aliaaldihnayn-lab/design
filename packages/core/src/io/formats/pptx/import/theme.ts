import type { Element } from '@xmldom/xmldom'
import { converter } from 'culori'
import { clamp } from 'es-toolkit'

import type { Color } from '@lawha/scene-graph/primitives'

import { attr, child, children, descend, numAttr } from './xml'

/** A presentation theme: its colour scheme, the master's colour map, and its fonts. */
export interface PPTXTheme {
  colors: Record<string, Color>
  /** Master `clrMap`: `tx1` → `dk1`, `bg1` → `lt1`, … */
  colorMap: Record<string, string>
  fonts: { major: string; minor: string; majorCS: string; minorCS: string }
  /** EMU widths of the theme's line styles, which `p:style/a:lnRef` picks by index from 1. */
  lineWidths: number[]
}

const DEFAULT_COLOR_MAP: Record<string, string> = {
  bg1: 'lt1',
  tx1: 'dk1',
  bg2: 'lt2',
  tx2: 'dk2'
}

const toHSL = converter('hsl')
const toRGB = converter('rgb')

/** Colours preset by name in DrawingML; the few decks use beyond the scheme. */
const PRESET_COLORS: Record<string, string> = {
  black: '000000',
  white: 'FFFFFF',
  red: 'FF0000',
  green: '008000',
  blue: '0000FF',
  yellow: 'FFFF00',
  gray: '808080',
  grey: '808080'
}

export function hexColor(value: string | null): Color | null {
  if (!value || !/^[0-9a-f]{6}$/i.test(value)) return null
  return {
    r: Number.parseInt(value.slice(0, 2), 16) / 255,
    g: Number.parseInt(value.slice(2, 4), 16) / 255,
    b: Number.parseInt(value.slice(4, 6), 16) / 255,
    a: 1
  }
}

export function readTheme(theme: Element | null, master: Element | null): PPTXTheme {
  const colors: Record<string, Color> = {}
  const scheme = descend(theme, 'themeElements', 'clrScheme')
  for (const entry of children(scheme)) {
    const value = child(entry, 'srgbClr') ?? child(entry, 'sysClr')
    const color = hexColor(attr(value, 'val'))
    const resolved =
      value?.localName === 'sysClr' ? (hexColor(attr(value, 'lastClr')) ?? color) : color
    if (resolved) colors[entry.localName ?? ''] = resolved
  }
  const colorMap: Record<string, string> = { ...DEFAULT_COLOR_MAP }
  const map = child(master, 'clrMap')
  if (map) {
    for (let i = 0; i < map.attributes.length; i++) {
      const item = map.attributes.item(i)
      if (item) colorMap[item.localName ?? item.name] = item.value
    }
  }
  const fontScheme = descend(theme, 'themeElements', 'fontScheme')
  const face = (kind: string, script: string) =>
    attr(descend(fontScheme, kind, script), 'typeface') ?? ''
  return {
    colors,
    colorMap,
    fonts: {
      major: face('majorFont', 'latin') || 'Calibri',
      minor: face('minorFont', 'latin') || 'Calibri',
      majorCS: face('majorFont', 'cs'),
      minorCS: face('minorFont', 'cs')
    },
    lineWidths: children(descend(theme, 'themeElements', 'fmtScheme', 'lnStyleLst'), 'ln').map(
      (ln) => numAttr(ln, 'w') ?? 9525
    )
  }
}

/** A theme font reference (`+mj-lt`, `+mn-cs`) as the font it names. */
export function resolveTypeface(typeface: string | null, theme: PPTXTheme): string | null {
  if (!typeface) return null
  switch (typeface) {
    case '+mj-lt':
    case '+mj-ea':
      return theme.fonts.major
    case '+mn-lt':
    case '+mn-ea':
      return theme.fonts.minor
    case '+mj-cs':
      return theme.fonts.majorCS || theme.fonts.major
    case '+mn-cs':
      return theme.fonts.minorCS || theme.fonts.minor
    default:
      return typeface
  }
}

/** The colour a DrawingML colour element names, with its modifiers (alpha, lumMod, …) applied. */
export function readColor(el: Element | undefined, theme: PPTXTheme): Color | null {
  if (!el) return null
  const base = baseColor(el, theme)
  return base ? applyModifiers({ ...base }, el) : null
}

function baseColor(el: Element, theme: PPTXTheme): Color | null {
  switch (el.localName) {
    case 'srgbClr':
      return hexColor(attr(el, 'val'))
    case 'sysClr':
      return hexColor(attr(el, 'lastClr')) ?? hexColor(attr(el, 'val'))
    case 'prstClr':
      return hexColor(PRESET_COLORS[attr(el, 'val') ?? ''] ?? null)
    case 'scrgbClr':
      return {
        r: (numAttr(el, 'r') ?? 0) / 100000,
        g: (numAttr(el, 'g') ?? 0) / 100000,
        b: (numAttr(el, 'b') ?? 0) / 100000,
        a: 1
      }
    case 'schemeClr': {
      const name = attr(el, 'val') ?? ''
      return theme.colors[theme.colorMap[name] ?? name] ?? null
    }
    default:
      return null
  }
}

function applyModifiers(color: Color, el: Element): Color {
  let result = color
  for (const modifier of children(el)) {
    const amount = (numAttr(modifier, 'val') ?? 0) / 100000
    switch (modifier.localName) {
      case 'alpha':
        result = { ...result, a: clamp(amount, 0, 1) }
        break
      case 'alphaMod':
        result = { ...result, a: clamp(result.a * amount, 0, 1) }
        break
      case 'lumMod':
      case 'lumOff':
      case 'satMod':
        result = adjustHSL(result, modifier.localName, amount)
        break
      case 'tint':
        result = mix(result, { r: 1, g: 1, b: 1, a: result.a }, 1 - amount)
        break
      case 'shade':
        result = mix(result, { r: 0, g: 0, b: 0, a: result.a }, 1 - amount)
        break
      default:
        break
    }
  }
  return result
}

function mix(from: Color, to: Color, t: number): Color {
  return {
    r: from.r + (to.r - from.r) * t,
    g: from.g + (to.g - from.g) * t,
    b: from.b + (to.b - from.b) * t,
    a: from.a
  }
}

function adjustHSL(color: Color, kind: string, amount: number): Color {
  const hsl = toHSL({ mode: 'rgb', r: color.r, g: color.g, b: color.b })
  if (kind === 'lumMod') hsl.l = clamp(hsl.l * amount, 0, 1)
  else if (kind === 'lumOff') hsl.l = clamp(hsl.l + amount, 0, 1)
  else hsl.s = clamp(hsl.s * amount, 0, 1)
  const rgb = toRGB(hsl)
  return {
    r: clamp(rgb.r, 0, 1),
    g: clamp(rgb.g, 0, 1),
    b: clamp(rgb.b, 0, 1),
    a: color.a
  }
}

/** The colour of a `solidFill` directly under `el`, or null without one. */
export function solidFillColor(el: Element | undefined, theme: PPTXTheme): Color | null {
  const fill = child(el, 'solidFill')
  return fill ? readColor(children(fill)[0], theme) : null
}
