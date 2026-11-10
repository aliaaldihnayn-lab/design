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
  offset: 'Offset',
  join: 'Joins',
  joinMiter: 'Miter',
  joinRound: 'Round',
  joinBevel: 'Bevel',
  applyOffset: 'Offset path',
  applyOffsetHint: 'Adds the outline grown or shrunk by the offset, under each layer',
  widthProfile: 'Width profile',
  profileUniform: 'Uniform',
  profileTaperStart: 'Taper start',
  profileTaperEnd: 'Taper end',
  profileTaperBoth: 'Taper both ends',
  profileBulge: 'Bulge',
  profilePinch: 'Pinch',
  applyWidth: 'Apply width profile',
  applyWidthHint: 'Turns the stroke into a shape whose width varies along the path',
  blendSteps: 'Steps',
  makeBlend: 'Blend the two layers',
  makeBlendHint: 'Adds shapes that step from the lower layer to the upper one',
  makePattern: 'Fill with the top layer as a pattern',
  makePatternHint: 'Tiles the upper layer across the lower one',
  imageTrace: 'Image Trace on this device',
  tracingImage: 'Tracing image…',
  imageTraced: 'Image traced into vectors.',
  traceFailed: params('Could not trace this image: {error}'),
  done: params('Updated {count}'),
  failed: params('Could not change the paths: {error}')
} as const

export const pathMessages = i18n('paths', pathMessageDefaults)
