import type { Vector } from '../primitives'

/** Illustrator's Warp presets (Effect → Warp, Object → Envelope Distort → Make with Warp). */
export const WARP_PRESETS = [
  'arc',
  'arch',
  'bulge',
  'flag',
  'wave',
  'fish',
  'rise',
  'squeeze',
  'twist'
] as const

export type WarpPreset = (typeof WARP_PRESETS)[number]

/** The most rows or columns an envelope mesh has. */
export const MAX_MESH_CELLS = 16

/** The most width points a live width profile keeps. */
export const MAX_WIDTH_POINTS = 32

/** The most steps a live blend makes. */
export const MAX_BLEND_STEPS = 256

/**
 * A layer's outline before a live effect reshaped it: SVG path data in the layer's own
 * coordinates, so the layer can move and still be reshaped from it.
 */
export interface PathEffectSource {
  path: string
  evenOdd: boolean
}

/**
 * Where an envelope mesh point went, in units of the source outline's box (0…1 across both
 * ways, so the flat mesh has point `(column / columns, row / rows)`), and its curve handles as
 * offsets from it in the same units. A handle left out runs straight to the next point.
 */
export interface MeshPoint {
  x: number
  y: number
  left?: Vector
  right?: Vector
  up?: Vector
  down?: Vector
}

/** Which of a mesh point's four curve handles. */
export type MeshHandleSide = 'left' | 'right' | 'up' | 'down'

/** A width point: at `t` along the path (0 start, 1 end) the stroke is `width` times its weight. */
export interface WidthPoint {
  t: number
  width: number
}
