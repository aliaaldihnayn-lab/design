import * as v from 'valibot'

import { MAX_MESH_CELLS } from '@lawha/scene-graph/path-effects'

/** One or more layers, by id. */
export const layerIdsSchema = v.pipe(v.array(v.string()), v.minLength(1))

export const layerIdsInputSchema = v.strictObject({ ids: layerIdsSchema })

export const layerIdInputSchema = v.strictObject({ id: v.string() })

/** A grid point of an envelope mesh and how far to move it, in pixels. */
export const meshMoveSchema = v.strictObject({
  row: v.pipe(v.number(), v.integer(), v.minValue(0)),
  column: v.pipe(v.number(), v.integer(), v.minValue(0)),
  dx: v.number(),
  dy: v.number()
})

export const meshCellCountSchema = v.pipe(
  v.number(),
  v.integer(),
  v.minValue(1),
  v.maxValue(MAX_MESH_CELLS)
)
