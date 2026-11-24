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

const ascii = (bytes: Uint8Array, from: number, length: number) =>
  String.fromCharCode(...bytes.subarray(from, from + length))

/** Pixel size from a WebP file's first chunk: lossy (`VP8 `), lossless, or extended. */
function webpSize(bytes: Uint8Array, view: DataView): { width: number; height: number } | null {
  if (bytes.length < 30 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP') {
    return null
  }
  const chunk = ascii(bytes, 12, 4)
  if (chunk === 'VP8 ') {
    return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff }
  }
  if (chunk === 'VP8L') {
    const bits = view.getUint32(21, true)
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
  }
  if (chunk === 'VP8X') {
    const u24 = (at: number) => bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16)
    return { width: u24(24) + 1, height: u24(27) + 1 }
  }
  return null
}

/** Pixel size from a BMP header, whose height is negative for top-down rows. */
function bmpSize(bytes: Uint8Array, view: DataView): { width: number; height: number } | null {
  if (bytes.length <= 26 || ascii(bytes, 0, 2) !== 'BM') return null
  return { width: Math.abs(view.getInt32(18, true)), height: Math.abs(view.getInt32(22, true)) }
}

/**
 * Pixel size read from a PNG, GIF, JPEG, WebP, or BMP header; null when the format is not one
 * of them.
 */
export function imageSize(bytes: Uint8Array): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const other = webpSize(bytes, view) ?? bmpSize(bytes, view)
  if (other) return other
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
