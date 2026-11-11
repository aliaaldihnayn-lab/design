import { computed } from 'vue'
import type { Ref } from 'vue'

import type { Fill, GradientStop } from '@lawha/scene-graph'
import { colorToCSS } from '@lawha/scene-graph/color'
import { DEFAULT_GRADIENT_TRANSFORM, defaultGradientStops } from '@lawha/scene-graph/gradient'
import type { Color } from '@lawha/scene-graph/primitives'

import type { FillCategory } from './types'

const FILL_CATEGORY: Partial<Record<Fill['type'], FillCategory>> = {
  SOLID: 'SOLID',
  GRADIENT_LINEAR: 'GRADIENT',
  GRADIENT_RADIAL: 'GRADIENT',
  GRADIENT_ANGULAR: 'GRADIENT',
  GRADIENT_DIAMOND: 'GRADIENT',
  IMAGE: 'IMAGE',
  PATTERN: 'PATTERN'
}

/** A pattern's swatch: a grid of dots, since its tile is a layer the swatch cannot draw. */
const PATTERN_SWATCH =
  'radial-gradient(circle, rgb(127 127 127) 1.5px, transparent 1.6px) 0 0 / 5px 5px, rgb(230 230 230)'

function effectiveColor(color: Color, opacity: number): Color {
  return { ...color, a: color.a * opacity }
}

function gradientCSS(stops: GradientStop[], opacity: number): string {
  return stops
    .map((stop) => `${colorToCSS(effectiveColor(stop.color, opacity))} ${stop.position * 100}%`)
    .join(', ')
}

export function fillCategory(fill: Fill): FillCategory {
  return FILL_CATEGORY[fill.type] ?? 'SOLID'
}

export function fillIsTransparent(fill: Fill): boolean {
  if (fill.opacity < 1) return true
  if (fillCategory(fill) === 'GRADIENT')
    return fill.gradientStops?.some((stop) => stop.color.a < 1) ?? fill.color.a < 1
  return fill.color.a < 1
}

export function fillSwatchBackground(fill: Fill): string {
  if (fillCategory(fill) === 'PATTERN') return PATTERN_SWATCH
  if (fillCategory(fill) === 'GRADIENT' && fill.gradientStops?.length) {
    return `linear-gradient(to right, ${gradientCSS(fill.gradientStops, fill.opacity)})`
  }
  return colorToCSS(effectiveColor(fill.color, fill.opacity))
}

/** Fill category state and immutable conversion actions without picker or popover behavior. */
export function useFill(fill: Ref<Fill>, onUpdate: (fill: Fill) => void) {
  const category = computed(() => fillCategory(fill.value))
  const swatchBackground = computed(() => fillSwatchBackground(fill.value))
  const transparent = computed(() => fillIsTransparent(fill.value))

  function toSolid() {
    if (category.value === 'SOLID') return
    const color = fill.value.gradientStops?.[0]?.color ?? fill.value.color
    onUpdate({ ...fill.value, type: 'SOLID', color: { ...color } })
  }

  function toGradient() {
    if (category.value === 'GRADIENT') return
    const gradientStops = fill.value.gradientStops?.length
      ? structuredClone(fill.value.gradientStops)
      : defaultGradientStops(fill.value.color)
    onUpdate({
      ...fill.value,
      type: 'GRADIENT_LINEAR',
      gradientStops,
      gradientTransform: fill.value.gradientTransform ?? { ...DEFAULT_GRADIENT_TRANSFORM }
    })
  }

  function toImage() {
    if (category.value === 'IMAGE') return
    onUpdate({ ...fill.value, type: 'IMAGE' })
  }

  /** A pattern paint; its tile is chosen in the pattern picker, so none is drawn until then. */
  function toPattern() {
    if (category.value === 'PATTERN') return
    onUpdate({
      ...fill.value,
      type: 'PATTERN',
      scale: fill.value.scale ?? 1,
      patternSpacing: fill.value.patternSpacing ?? { x: 0, y: 0 },
      patternTileType: fill.value.patternTileType ?? 'RECTANGULAR',
      horizontalAlignment: fill.value.horizontalAlignment ?? 'START',
      verticalAlignment: fill.value.verticalAlignment ?? 'START'
    })
  }

  const actions = { toSolid, toGradient, toImage, toPattern }

  return {
    category,
    swatchBackground,
    transparent,
    actions,
    toSolid,
    toGradient,
    toImage,
    toPattern
  }
}
