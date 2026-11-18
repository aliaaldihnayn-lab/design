/**
 * The parts of the Google Docs API `Document` resource the converter reads
 * (https://developers.google.com/workspace/docs/api/reference/rest/v1/documents). Everything is
 * optional, as the API omits defaults; responses are checked with `googleDocumentSchema`.
 */

export interface GoogleDimension {
  magnitude?: number
  unit?: string
}

export interface GoogleColor {
  color?: { rgbColor?: { red?: number; green?: number; blue?: number } }
}

export interface GoogleTextStyle {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strikethrough?: boolean
  baselineOffset?: string
  fontSize?: GoogleDimension
  weightedFontFamily?: { fontFamily?: string }
  foregroundColor?: GoogleColor
  backgroundColor?: GoogleColor
  link?: { url?: string }
}

export interface GoogleParagraphElement {
  startIndex?: number
  endIndex?: number
  textRun?: { content?: string; textStyle?: GoogleTextStyle }
  autoText?: { type?: string; textStyle?: GoogleTextStyle }
  pageBreak?: Record<string, unknown>
  inlineObjectElement?: { inlineObjectId?: string }
}

export interface GoogleParagraph {
  elements?: GoogleParagraphElement[]
  paragraphStyle?: { namedStyleType?: string; alignment?: string; direction?: string }
  bullet?: { listId?: string; nestingLevel?: number }
}

export interface GoogleTableCell {
  content?: GoogleStructuralElement[]
  tableCellStyle?: { rowSpan?: number; columnSpan?: number }
}

export interface GoogleTable {
  rows?: number
  columns?: number
  tableRows?: Array<{ tableCells?: GoogleTableCell[] }>
}

export interface GoogleStructuralElement {
  startIndex?: number
  endIndex?: number
  paragraph?: GoogleParagraph
  table?: GoogleTable
  sectionBreak?: Record<string, unknown>
  tableOfContents?: Record<string, unknown>
}

export interface GoogleList {
  listProperties?: {
    nestingLevels?: Array<{ glyphType?: string; glyphSymbol?: string; startNumber?: number }>
  }
}

export interface GoogleInlineObject {
  inlineObjectProperties?: {
    embeddedObject?: {
      imageProperties?: { contentUri?: string }
      size?: { width?: GoogleDimension; height?: GoogleDimension }
      description?: string
    }
  }
}

export interface GoogleDocument {
  documentId?: string
  title?: string
  revisionId?: string
  body?: { content?: GoogleStructuralElement[] }
  headers?: Record<string, { content?: GoogleStructuralElement[] }>
  footers?: Record<string, { content?: GoogleStructuralElement[] }>
  lists?: Record<string, GoogleList>
  inlineObjects?: Record<string, GoogleInlineObject>
  documentStyle?: {
    defaultHeaderId?: string
    defaultFooterId?: string
    pageSize?: { width?: GoogleDimension; height?: GoogleDimension }
    marginTop?: GoogleDimension
    marginBottom?: GoogleDimension
    marginLeft?: GoogleDimension
    marginRight?: GoogleDimension
    marginHeader?: GoogleDimension
    marginFooter?: GoogleDimension
  }
}

/** One `documents.batchUpdate` request, as the API takes it. */
export type GoogleDocsRequest = Record<string, unknown>
