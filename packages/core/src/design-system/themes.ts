import { converter } from 'culori'

import type { Color } from '@lawha/scene-graph/primitives'

import type { FigmaAPI } from '#core/figma-api'

const toOKLCH = converter('oklch')
const toRGB = converter('rgb')

export const LIGHT_MODE = 'Light'
export const DARK_MODE = 'Dark'

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/**
 * A colour token's value in dark mode, by its role: surfaces and text swap lightness (a
 * background becomes a deep surface, primary text near white), the neutral scale runs the other
 * way, and brand colours lift just enough to read on a dark surface, keeping their hue.
 */
export function darkColor(name: string, color: Color): Color {
  const c = toOKLCH({ mode: 'rgb', r: color.r, g: color.g, b: color.b })
  const hue = c.h ?? 0
  let l: number
  let chroma = c.c
  if (name === 'color/background') {
    l = clamp(0.18 - (c.l - 0.95) * 0.5, 0.12, 0.24)
    chroma = Math.min(chroma, 0.02)
  } else if (name.startsWith('color/text/') || name.startsWith('color/neutral/') || chroma < 0.04) {
    l = clamp(1.1 - c.l, 0.1, 0.97)
    chroma = Math.min(chroma, 0.03)
  } else {
    l = clamp(c.l < 0.62 ? c.l + 0.12 : c.l, 0.55, 0.88)
    chroma *= 0.92
  }
  const rgb = toRGB({ mode: 'oklch', l, c: chroma, h: hue })
  return {
    r: clamp(rgb.r, 0, 1),
    g: clamp(rgb.g, 0, 1),
    b: clamp(rgb.b, 0, 1),
    a: color.a
  }
}

/**
 * Gives a collection Light and Dark modes: the first mode becomes Light, and Dark is added
 * when missing. Returns both mode ids.
 */
export function ensureThemeModes(
  figma: FigmaAPI,
  collectionId: string
): { light: string; dark: string } {
  const collection = figma.variables.getVariableCollectionById(collectionId)
  if (!collection) throw new Error(`Collection ${collectionId} not found`)
  const light = collection.defaultModeId
  const lightMode = collection.modes.find((mode) => mode.modeId === light)
  if (lightMode && lightMode.name !== LIGHT_MODE && collection.modes.length === 1)
    collection.renameMode(light, LIGHT_MODE)
  const dark =
    collection.modes.find((mode) => mode.name === DARK_MODE)?.modeId ??
    collection.addMode(DARK_MODE)
  return { light, dark }
}
