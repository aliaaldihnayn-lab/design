import * as v from 'valibot'

import { PAGE_SIZE_IDS } from '#core/writer/model'

const textDirectionSchema = v.picklist(['rtl', 'ltr', 'auto'])

export const blockSpecInputSchema = v.pipe(
  v.strictObject({
    type: v.pipe(
      v.picklist(['paragraph', 'heading', 'bullet', 'numbered', 'pageBreak', 'table']),
      v.description('Block kind; consecutive bullet or numbered items join one list')
    ),
    text: v.optional(v.pipe(v.string(), v.description('Text; \\n is a line break'))),
    level: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(6))),
    dir: v.optional(
      v.pipe(
        textDirectionSchema,
        v.description('Paragraph direction; defaults to the first letter')
      )
    ),
    align: v.optional(v.picklist(['left', 'center', 'right', 'justify'])),
    bold: v.optional(v.boolean()),
    italic: v.optional(v.boolean()),
    rows: v.optional(
      v.pipe(v.array(v.array(v.string())), v.description('Table cell texts, row by row'))
    ),
    header: v.optional(v.pipe(v.boolean(), v.description('First table row is a header row')))
  }),
  v.description('One block of the document')
)

export const blockSpecsInputSchema = v.pipe(v.array(blockSpecInputSchema), v.minLength(1))

export const blockIndexInputSchema = v.pipe(
  v.number(),
  v.integer(),
  v.minValue(0),
  v.description('Block index from read_document')
)

const marginMMSchema = v.optional(v.pipe(v.number(), v.minValue(0), v.maxValue(100)))

export const pageInputSchema = v.strictObject({
  size: v.optional(v.picklist(PAGE_SIZE_IDS)),
  orientation: v.optional(v.picklist(['portrait', 'landscape'])),
  marginsMM: v.optional(
    v.strictObject({
      top: marginMMSchema,
      right: marginMMSchema,
      bottom: marginMMSchema,
      left: marginMMSchema
    })
  )
})
