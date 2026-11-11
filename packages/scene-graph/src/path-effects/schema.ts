import * as v from 'valibot'

import { MAX_BLEND_STEPS, MAX_MESH_CELLS, MAX_WIDTH_POINTS, WARP_PRESETS } from './model'

const finiteSchema = v.pipe(v.number(), v.finite())
const unitAmountSchema = v.pipe(v.number(), v.minValue(-1), v.maxValue(1))
const vectorSchema = v.object({ x: finiteSchema, y: finiteSchema })

const pathEffectSourceSchema = v.object({
  path: v.pipe(v.string(), v.nonEmpty(), v.maxLength(2_000_000)),
  evenOdd: v.boolean()
})

const meshPointSchema = v.object({
  x: finiteSchema,
  y: finiteSchema,
  left: v.optional(vectorSchema),
  right: v.optional(vectorSchema),
  up: v.optional(vectorSchema),
  down: v.optional(vectorSchema)
})

const cellCountSchema = v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(MAX_MESH_CELLS))

/** A warp preset kept live on the vector it made. */
const warpEffectSchema = v.object({
  kind: v.literal('warp'),
  source: pathEffectSourceSchema,
  preset: v.picklist(WARP_PRESETS),
  bend: unitAmountSchema,
  horizontal: unitAmountSchema,
  vertical: unitAmountSchema,
  vertically: v.boolean()
})

/** An envelope mesh kept live: `(rows + 1) × (columns + 1)` points, row by row. */
const meshEffectSchema = v.pipe(
  v.object({
    kind: v.literal('mesh'),
    source: pathEffectSourceSchema,
    rows: cellCountSchema,
    columns: cellCountSchema,
    points: v.array(meshPointSchema)
  }),
  v.check(
    ({ rows, columns, points }) => points.length === (rows + 1) * (columns + 1),
    'A mesh has (rows + 1) × (columns + 1) points'
  )
)

/** A width profile kept live: the stroke's centre line, its weight, and its width points. */
const widthEffectSchema = v.object({
  kind: v.literal('width'),
  source: pathEffectSourceSchema,
  weight: v.pipe(v.number(), v.finite(), v.minValue(0)),
  points: v.pipe(
    v.array(
      v.object({
        t: v.pipe(v.number(), v.minValue(0), v.maxValue(1)),
        width: v.pipe(v.number(), v.minValue(0), v.maxValue(20))
      })
    ),
    v.minLength(1),
    v.maxLength(MAX_WIDTH_POINTS)
  )
})

/** A live path effect on the vector it made, which can be edited, expanded, or released. */
export const pathEffectSchema = v.variant('kind', [
  warpEffectSchema,
  meshEffectSchema,
  widthEffectSchema
])

export type PathEffect = v.InferOutput<typeof pathEffectSchema>
export type WarpEffect = v.InferOutput<typeof warpEffectSchema>
export type MeshEffect = v.InferOutput<typeof meshEffectSchema>
export type WidthEffect = v.InferOutput<typeof widthEffectSchema>

/**
 * A live blend, on the group that holds it: its two ends and the layer its steps follow, by id,
 * and how many steps it makes, or how far apart they are. The steps are the group's children
 * between the ends that the blend made, listed by id.
 */
export const liveBlendSchema = v.object({
  fromId: v.string(),
  toId: v.string(),
  spineId: v.optional(v.string()),
  spacing: v.picklist(['steps', 'distance']),
  steps: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(MAX_BLEND_STEPS)),
  distance: v.pipe(v.number(), v.finite(), v.minValue(1)),
  stepIds: v.array(v.string())
})

export type LiveBlend = v.InferOutput<typeof liveBlendSchema>
