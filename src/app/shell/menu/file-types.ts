import { uniq } from 'es-toolkit/array'

import { BUILTIN_IO_FORMATS, IORegistry } from '@lawha/core/io'

const io = new IORegistry(BUILTIN_IO_FORMATS)
const DOM_DOCUMENT_TYPES = { 'text/html': ['.html', '.htm'], 'application/xhtml+xml': ['.xhtml'] }

/** Every extension the Open dialog accepts: each readable format's, and HTML pages. */
export const READABLE_DOCUMENT_EXTENSIONS = uniq([
  ...io.listReadableFormats().flatMap((format) => format.extensions),
  ...Object.values(DOM_DOCUMENT_TYPES)
    .flat()
    .map((extension) => extension.slice(1))
])

/** Whether the Open dialog or a drop can open a file of this name. */
export function isSupportedDesignFile(fileName: string): boolean {
  const lowerName = fileName.toLowerCase()
  return (
    io.findReader(fileName) !== null ||
    Object.values(DOM_DOCUMENT_TYPES)
      .flat()
      .some((extension) => lowerName.endsWith(extension))
  )
}

/**
 * The browser open picker's one file type, built from the same readable formats as the desktop
 * dialog, so every file Lawha opens (PDF, Illustrator, Photoshop, PowerPoint, draw.io, Mermaid,
 * `.fig`, `.pen`, HTML) can be chosen. Each extension is listed under its format's first MIME type.
 */
export function designFilePickerTypes(): FilePickerAcceptType[] {
  const accept: Record<string, string[]> = {}
  for (const format of io.listReadableFormats()) {
    const mime = format.mimeTypes[0] ?? 'application/octet-stream'
    accept[mime] = uniq([...(accept[mime] ?? []), ...format.extensions.map((ext) => `.${ext}`)])
  }
  for (const [mime, extensions] of Object.entries(DOM_DOCUMENT_TYPES)) {
    accept[mime] = uniq([...(accept[mime] ?? []), ...extensions])
  }
  return [{ description: 'Design file', accept }]
}
