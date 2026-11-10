import { params } from '@nanostores/i18n'

import { i18n } from '#vue/i18n/create'

/** Photo editing: image adjustments, and the pixel tools that follow. */
export const photoMessageDefaults = {
  adjustments: 'Adjustments',
  reset: 'Reset',
  exposure: 'Exposure',
  contrast: 'Contrast',
  brightness: 'Brightness',
  saturation: 'Saturation',
  vibrance: 'Vibrance',
  temperature: 'Temperature',
  tint: 'Tint',
  highlights: 'Highlights',
  shadows: 'Shadows',
  hue: 'Hue',
  sharpen: 'Sharpen',
  noise: 'Grain',
  vignette: 'Vignette',
  invert: 'Invert',
  levels: 'Levels',
  blackPoint: 'Black point',
  whitePoint: 'White point',
  midtones: 'Midtones',
  curve: 'Curve',
  resetCurve: 'Reset curve',
  removeBackground: 'Remove background',
  removingBackground: 'Removing background… The first time downloads the model (about 45 MB).',
  backgroundRemoved: 'Background removed.',
  removeBackgroundFailed: params('Could not remove the background: {error}'),
  brushColor: 'Color',
  brushSize: 'Size',
  brushHardness: 'Hardness',
  brushOpacity: 'Opacity',
  tolerance: 'Tolerance',
  contiguous: 'Contiguous',
  selectAll: 'Select all',
  deselect: 'Deselect',
  invertSelection: 'Invert selection',
  maskFromSelection: 'Mask from selection',
  invertMask: 'Invert mask',
  feather: 'Feather',
  cloneSourceHint: 'Alt-click to set the source'
} as const

export const photoMessages = i18n('photo', photoMessageDefaults)
