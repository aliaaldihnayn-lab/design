import * as v from 'valibot'

import type { WriterMark, WriterNode } from './model'

export const writerMarkSchema: v.GenericSchema<WriterMark> = v.object({
  type: v.string(),
  attrs: v.optional(v.record(v.string(), v.unknown()))
})

export const writerNodeSchema: v.GenericSchema<WriterNode> = v.object({
  type: v.string(),
  attrs: v.optional(v.record(v.string(), v.unknown())),
  content: v.optional(v.array(v.lazy(() => writerNodeSchema))),
  marks: v.optional(v.array(writerMarkSchema)),
  text: v.optional(v.string())
})

const twipsSchema = v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(31_680))

export const pageSetupSchema = v.object({
  width: twipsSchema,
  height: twipsSchema,
  margins: v.object({
    top: twipsSchema,
    right: twipsSchema,
    bottom: twipsSchema,
    left: twipsSchema,
    header: twipsSchema,
    footer: twipsSchema
  })
})

export const writerCommentSchema = v.object({
  id: v.string(),
  author: v.string(),
  initials: v.optional(v.string()),
  date: v.string(),
  text: v.string(),
  resolved: v.optional(v.boolean())
})

export const writerDocumentSchema = v.object({
  body: writerNodeSchema,
  page: pageSetupSchema,
  header: v.nullable(writerNodeSchema),
  footer: v.nullable(writerNodeSchema),
  comments: v.array(writerCommentSchema),
  footnotes: v.array(v.object({ id: v.string(), content: v.array(writerNodeSchema) })),
  trackChanges: v.boolean(),
  watermark: v.nullable(v.object({ text: v.string(), color: v.optional(v.string()) })),
  title: v.string()
})
