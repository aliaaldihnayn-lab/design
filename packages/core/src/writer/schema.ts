import * as v from 'valibot'

import type { GoogleDocument, GoogleStructuralElement } from './google-docs/types'
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

const googleDimensionSchema = v.object({
  magnitude: v.optional(v.number()),
  unit: v.optional(v.string())
})

const googleColorSchema = v.object({
  color: v.optional(
    v.object({
      rgbColor: v.optional(
        v.object({
          red: v.optional(v.number()),
          green: v.optional(v.number()),
          blue: v.optional(v.number())
        })
      )
    })
  )
})

const googleTextStyleSchema = v.object({
  bold: v.optional(v.boolean()),
  italic: v.optional(v.boolean()),
  underline: v.optional(v.boolean()),
  strikethrough: v.optional(v.boolean()),
  baselineOffset: v.optional(v.string()),
  fontSize: v.optional(googleDimensionSchema),
  weightedFontFamily: v.optional(v.object({ fontFamily: v.optional(v.string()) })),
  foregroundColor: v.optional(googleColorSchema),
  backgroundColor: v.optional(googleColorSchema),
  link: v.optional(v.object({ url: v.optional(v.string()) }))
})

const googleParagraphSchema = v.object({
  elements: v.optional(
    v.array(
      v.object({
        startIndex: v.optional(v.number()),
        endIndex: v.optional(v.number()),
        textRun: v.optional(
          v.object({
            content: v.optional(v.string()),
            textStyle: v.optional(googleTextStyleSchema)
          })
        ),
        autoText: v.optional(
          v.object({ type: v.optional(v.string()), textStyle: v.optional(googleTextStyleSchema) })
        ),
        pageBreak: v.optional(v.record(v.string(), v.unknown())),
        inlineObjectElement: v.optional(v.object({ inlineObjectId: v.optional(v.string()) }))
      })
    )
  ),
  paragraphStyle: v.optional(
    v.object({
      namedStyleType: v.optional(v.string()),
      alignment: v.optional(v.string()),
      direction: v.optional(v.string())
    })
  ),
  bullet: v.optional(
    v.object({ listId: v.optional(v.string()), nestingLevel: v.optional(v.number()) })
  )
})

const googleStructuralElementSchema: v.GenericSchema<GoogleStructuralElement> = v.object({
  startIndex: v.optional(v.number()),
  endIndex: v.optional(v.number()),
  paragraph: v.optional(googleParagraphSchema),
  table: v.optional(
    v.object({
      rows: v.optional(v.number()),
      columns: v.optional(v.number()),
      tableRows: v.optional(
        v.array(
          v.object({
            tableCells: v.optional(
              v.array(
                v.object({
                  content: v.optional(v.array(v.lazy(() => googleStructuralElementSchema))),
                  tableCellStyle: v.optional(
                    v.object({
                      rowSpan: v.optional(v.number()),
                      columnSpan: v.optional(v.number())
                    })
                  )
                })
              )
            )
          })
        )
      )
    })
  ),
  sectionBreak: v.optional(v.record(v.string(), v.unknown())),
  tableOfContents: v.optional(v.record(v.string(), v.unknown()))
})

const googleSegmentSchema = v.object({
  content: v.optional(v.array(googleStructuralElementSchema))
})

/** A Google Docs API `Document`, as far as the converter reads it. */
export const googleDocumentSchema: v.GenericSchema<GoogleDocument> = v.object({
  documentId: v.optional(v.string()),
  title: v.optional(v.string()),
  revisionId: v.optional(v.string()),
  body: v.optional(googleSegmentSchema),
  headers: v.optional(v.record(v.string(), googleSegmentSchema)),
  footers: v.optional(v.record(v.string(), googleSegmentSchema)),
  lists: v.optional(
    v.record(
      v.string(),
      v.object({
        listProperties: v.optional(
          v.object({
            nestingLevels: v.optional(
              v.array(
                v.object({
                  glyphType: v.optional(v.string()),
                  glyphSymbol: v.optional(v.string()),
                  startNumber: v.optional(v.number())
                })
              )
            )
          })
        )
      })
    )
  ),
  inlineObjects: v.optional(
    v.record(
      v.string(),
      v.object({
        inlineObjectProperties: v.optional(
          v.object({
            embeddedObject: v.optional(
              v.object({
                imageProperties: v.optional(v.object({ contentUri: v.optional(v.string()) })),
                size: v.optional(
                  v.object({
                    width: v.optional(googleDimensionSchema),
                    height: v.optional(googleDimensionSchema)
                  })
                ),
                description: v.optional(v.string())
              })
            )
          })
        )
      })
    )
  ),
  documentStyle: v.optional(
    v.object({
      defaultHeaderId: v.optional(v.string()),
      defaultFooterId: v.optional(v.string()),
      pageSize: v.optional(
        v.object({
          width: v.optional(googleDimensionSchema),
          height: v.optional(googleDimensionSchema)
        })
      ),
      marginTop: v.optional(googleDimensionSchema),
      marginBottom: v.optional(googleDimensionSchema),
      marginLeft: v.optional(googleDimensionSchema),
      marginRight: v.optional(googleDimensionSchema),
      marginHeader: v.optional(googleDimensionSchema),
      marginFooter: v.optional(googleDimensionSchema)
    })
  )
})
