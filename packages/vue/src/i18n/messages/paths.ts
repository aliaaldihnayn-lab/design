import { params } from '@nanostores/i18n'

import { i18n } from '#vue/i18n/create'

/** Illustrator's path effects: warps, envelopes, offsets, width, blends, and pattern fills. */
export const pathMessageDefaults = {
  section: 'Distort & paths',
  warp: 'Warp',
  warpStyle: 'Warp style',
  bend: 'Bend',
  horizontalDistortion: 'Horizontal distortion',
  verticalDistortion: 'Vertical distortion',
  applyWarp: 'Apply warp',
  applyWarpHint: 'Bends the outline and turns the layer into a vector',
  presetArc: 'Arc',
  presetArch: 'Arch',
  presetBulge: 'Bulge',
  presetFlag: 'Flag',
  presetWave: 'Wave',
  presetFish: 'Fish',
  presetRise: 'Rise',
  presetSqueeze: 'Squeeze',
  presetTwist: 'Twist',
  imageTrace: 'Image Trace on this device',
  tracingImage: 'Tracing image…',
  imageTraced: 'Image traced into vectors.',
  traceFailed: params('Could not trace this image: {error}'),
  done: params('Updated {count}'),
  failed: params('Could not change the paths: {error}')
} as const

export const pathMessages = i18n('paths', pathMessageDefaults)
