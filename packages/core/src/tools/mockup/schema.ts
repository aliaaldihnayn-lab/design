import * as v from 'valibot'

import { toolNumber } from '#core/tools/schema'

export const fitInputSchema = v.optional(
  v.pipe(
    v.picklist(['contain', 'cover']),
    v.description(
      'contain: scale the design to fit entirely inside (may leave margins). cover: scale to fill, cropping the overflow. Default contain.'
    )
  ),
  'contain'
)

/** The space between the copies a tool lays out in a row. */
export const copyGapInputSchema = v.optional(
  toolNumber(v.pipe(v.number(), v.minValue(0), v.description('Space between copies'))),
  100
)
