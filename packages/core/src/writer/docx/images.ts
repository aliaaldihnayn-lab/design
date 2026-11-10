import { fromUint8Array, isValid, toUint8Array } from 'js-base64'

export interface EmbeddedImage {
  bytes: Uint8Array
  mime: string
  extension: string
}

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'image/webp': 'webp',
  'image/svg+xml': 'svg'
}

const MIMES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  emf: 'image/emf',
  wmf: 'image/wmf'
}

/** The bytes of a `data:` image URL, or null for anything else. */
export function imageFromDataURL(src: string): EmbeddedImage | null {
  const match = /^data:([\w/+.-]+);base64,(.*)$/s.exec(src)
  if (!match) return null
  const mime = match[1].toLowerCase()
  const extension = EXTENSIONS[mime]
  if (!extension || !isValid(match[2])) return null
  return { bytes: toUint8Array(match[2]), mime, extension }
}

export function imageDataURL(bytes: Uint8Array, path: string): string {
  const extension = path.split('.').pop()?.toLowerCase() ?? 'png'
  return `data:${MIMES[extension] ?? 'application/octet-stream'};base64,${fromUint8Array(bytes)}`
}

export function contentTypeFor(extension: string): string {
  return MIMES[extension] ?? 'application/octet-stream'
}

/** Pixel size read from a PNG, GIF, or JPEG header; null when the format is not one of them. */
export function imageSize(bytes: Uint8Array): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50) {
    return { width: view.getUint32(16), height: view.getUint32(20) }
  }
  if (bytes.length > 10 && bytes[0] === 0x47 && bytes[1] === 0x49) {
    return { width: view.getUint16(6, true), height: view.getUint16(8, true) }
  }
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) return null
      const marker = bytes[offset + 1]
      const length = view.getUint16(offset + 2)
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc
      ) {
        return { width: view.getUint16(offset + 7), height: view.getUint16(offset + 5) }
      }
      offset += 2 + length
    }
  }
  return null
}
