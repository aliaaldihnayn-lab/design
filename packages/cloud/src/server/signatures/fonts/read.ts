import { readFile } from 'node:fs/promises'

/**
 * The Arabic font signed PDFs' audit pages name signers in, read from beside this file by
 * Node runtimes (the server itself never reads files); a missing file leaves Arabic names to the standard fonts, which cannot draw them.
 */
export async function readSignatureFont(): Promise<Uint8Array | undefined> {
  const url = new URL('NotoNaskhArabic-Regular.ttf', import.meta.url)
  return readFile(url).then(
    (bytes) => new Uint8Array(bytes),
    () => undefined
  )
}
