import type { TraceOptions } from './index'

/** Illustrator's Image Trace presets, as its panel names them. */
export const TRACE_PRESETS = ['logo', 'photo-high', 'photo-low', 'line-art', 'sketch'] as const

export type TracePreset = (typeof TRACE_PRESETS)[number]

/** How each preset reads an image: the longest side it traces at and its trace settings. */
const PRESET_SETTINGS: Record<TracePreset, { maxSide: number; options: Partial<TraceOptions> }> = {
  // Few flat colours with crisp corners.
  logo: { maxSide: 512, options: { colors: 6, tolerance: 1.2, noise: 12, cornerAngle: 60 } },
  'photo-high': {
    maxSide: 1024,
    options: { colors: 32, tolerance: 0.6, noise: 4, cornerAngle: 80 }
  },
  'photo-low': { maxSide: 512, options: { colors: 12, tolerance: 1.2, noise: 10 } },
  // Dark lines on white paper, the paper left out.
  'line-art': {
    maxSide: 1024,
    options: { threshold: 128, ignoreWhite: true, tolerance: 0.8, noise: 6, cornerAngle: 70 }
  },
  // Looser, softer strokes from a pencil drawing.
  sketch: {
    maxSide: 512,
    options: { threshold: 170, ignoreWhite: true, tolerance: 1.6, noise: 20, cornerAngle: 90 }
  }
}

/** Whether a preset traces in black and white, which its threshold then controls. */
export function tracePresetIsBlackAndWhite(preset: TracePreset): boolean {
  return PRESET_SETTINGS[preset].options.threshold !== undefined
}

/**
 * A preset's settings with the colour count or threshold chosen over its own: a black and white
 * preset takes the threshold, a colour one the colour count.
 */
export function tracePresetSettings(
  preset: TracePreset,
  overrides: { colors?: number; threshold?: number } = {}
): { maxSide: number; options: Partial<TraceOptions> } {
  const base = PRESET_SETTINGS[preset]
  const options = { ...base.options }
  if (tracePresetIsBlackAndWhite(preset)) {
    if (overrides.threshold !== undefined) options.threshold = overrides.threshold
  } else if (overrides.colors !== undefined) {
    options.colors = overrides.colors
  }
  return { maxSide: base.maxSide, options }
}
