import type { WriterDocument } from '#core/writer/model'

import { patchDocx } from './patch'
import { DocxReadError } from './read'
import { buildDocx } from './write'

export interface WriteDocxOptions {
  creator?: string
  /**
   * The package the document was opened from. Saving patches it, keeping every part and block
   * the edits did not touch as they were; a package that cannot be read is written anew.
   */
  source?: Uint8Array | null
}

/** The model as a Word `.docx` package: patched into `source` when given, else built anew. */
export function writeDocx(model: WriterDocument, options: WriteDocxOptions = {}): Uint8Array {
  if (options.source) {
    try {
      return patchDocx(options.source, model, options)
    } catch (error) {
      if (!(error instanceof DocxReadError)) throw error
    }
  }
  return buildDocx(model, options)
}
