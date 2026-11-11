import * as v from 'valibot'

import { colorSchema } from '../color/schema'
import { finiteNumberSchema, matrixSchema, vectorSchema } from '../primitives/schema'
import type { FillType, GradientTransform } from '../types'

/** An image fill's input levels: black and white points and the midtone gamma. */
export const imageLevelsSchema = v.object({
  black: v.pipe(v.number(), v.minValue(0), v.maxValue(1)),
  white: v.pipe(v.number(), v.minValue(0), v.maxValue(1)),
  gamma: v.pipe(v.number(), v.minValue(0.1), v.maxValue(10))
})

/** A point an image fill's tone curve runs through. */
export const curvePointSchema = v.object({
  x: v.pipe(v.number(), v.minValue(0), v.maxValue(1)),
  y: v.pipe(v.number(), v.minValue(0), v.maxValue(1))
})

/** The most points a tone curve takes. */
export const MAX_CURVE_POINTS = 32

export const gradientStopSchema = v.object({ position: finiteNumberSchema, color: colorSchema })

const transformRowSchema = v.strictTuple([
  finiteNumberSchema,
  finiteNumberSchema,
  finiteNumberSchema
])

/**
 * A paint's `gradientTransform` or `imageTransform` as an author writes it, read into the matrix
 * fields: Figma's two rows of three, as its plugin API gives them, or the fields themselves. An
 * extra row, value, or field is refused rather than dropped.
 */
export const paintTransformSchema = v.union(
  [
    v.pipe(
      v.strictTuple([transformRowSchema, transformRowSchema]),
      v.transform(([[m00, m01, m02], [m10, m11, m12]]): GradientTransform => ({
        m00,
        m01,
        m02,
        m10,
        m11,
        m12
      }))
    ),
    v.strictObject(matrixSchema.entries)
  ],
  (issue) =>
    `Expected [[a, b, c], [d, e, f]] or { m00, m01, m02, m10, m11, m12 } but received ${issue.received}`
)

/** Every fill type, as a record so a type added to `FillType` fails to compile until listed. */
const FILL_TYPES = {
  SOLID: true,
  GRADIENT_LINEAR: true,
  GRADIENT_RADIAL: true,
  GRADIENT_ANGULAR: true,
  GRADIENT_DIAMOND: true,
  IMAGE: true,
  VIDEO: true,
  PATTERN: true,
  NOISE: true,
  CUSTOM: true
} as const satisfies Record<FillType, true>

/**
 * A fill as data from outside the process, such as a collaborator's, can hold it: the fields a
 * renderer reads without checking are checked, and the rest pass through as they are.
 */
export const fillSchema = v.looseObject({
  type: v.picklist(Object.keys(FILL_TYPES) as FillType[]),
  color: colorSchema,
  opacity: finiteNumberSchema,
  visible: v.boolean(),
  gradientStops: v.optional(v.array(gradientStopSchema)),
  gradientTransform: v.optional(matrixSchema),
  imageTransform: v.optional(matrixSchema),
  patternSpacing: v.optional(vectorSchema),
  noiseSize: v.optional(vectorSchema)
})
