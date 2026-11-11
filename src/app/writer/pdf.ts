import { fontManager } from '@lawha/core/text'
import {
  DEFAULT_FALLBACK_FAMILIES,
  exportWriterPDF,
  type WriterDocument,
  type WriterFontRequest
} from '@lawha/core/writer'

import { PDF, saveFileAs } from './files'
import { writerAuthor } from './session'

/**
 * The document editor's direct PDF export: the document laid out and written as PDF in the app,
 * its fonts loaded the way the canvas loads them (installed, bundled, cached, then the online
 * providers), so nothing goes through the browser's print dialog.
 */

function styleName({ bold, italic }: Pick<WriterFontRequest, 'bold' | 'italic'>): string {
  if (bold && italic) return 'Bold Italic'
  if (bold) return 'Bold'
  if (italic) return 'Italic'
  return 'Regular'
}

/** The font file for a face the document uses, through the app's font manager. */
export function loadWriterFont(request: WriterFontRequest): Promise<ArrayBuffer | null> {
  return fontManager.loadFont(request.family, styleName(request), request.text).catch(() => null)
}

export function writerPDFBytes(document: WriterDocument): Promise<Uint8Array> {
  return exportWriterPDF(document, {
    fonts: loadWriterFont,
    fallbackFamilies: DEFAULT_FALLBACK_FAMILIES,
    author: writerAuthor.value || undefined
  })
}

/** Exports the document as a PDF file; false when the person cancelled choosing where. */
export async function saveWriterPDF(document: WriterDocument, name: string): Promise<boolean> {
  const bytes = await writerPDFBytes(document)
  return (await saveFileAs(bytes, name.replace(/\.docx$/i, '') || 'Document', PDF)) !== null
}
