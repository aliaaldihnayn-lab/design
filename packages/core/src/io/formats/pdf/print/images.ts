import { deflateSync, inflateSync } from 'fflate'

import { rgbToCMYK, type ToCMYK } from './color'
import { dictValue, removeDictKey, setDictValue, type PDFObject } from './file'

/** Decoded RGBA pixels of an encoded image (JPEG), for images PDF stores as DCT data. */
export type PDFImageDecoder = (
  bytes: Uint8Array
) => { width: number; height: number; data: Uint8Array } | null

/** The PNG Paeth predictor: whichever neighbour is nearest their gradient. */
function paeth(left: number, up: number, upLeft: number): number {
  const p = left + up - upLeft
  const pa = Math.abs(p - left)
  const pb = Math.abs(p - up)
  const pc = Math.abs(p - upLeft)
  if (pa <= pb && pa <= pc) return left
  return pb <= pc ? up : upLeft
}

/** PNG row filters undone, as a `/Predictor` 10–15 Flate stream stores rows. */
function unpredict(data: Uint8Array, columns: number, colors: number): Uint8Array | null {
  const stride = columns * colors
  const rows = Math.floor(data.length / (stride + 1))
  const out = new Uint8Array(rows * stride)
  for (let row = 0; row < rows; row++) {
    const filter = data[row * (stride + 1)]
    const src = row * (stride + 1) + 1
    const dst = row * stride
    for (let i = 0; i < stride; i++) {
      const raw = data[src + i]
      const left = i >= colors ? out[dst + i - colors] : 0
      const up = row > 0 ? out[dst - stride + i] : 0
      const upLeft = row > 0 && i >= colors ? out[dst - stride + i - colors] : 0
      let value: number
      switch (filter) {
        case 0:
          value = raw
          break
        case 1:
          value = raw + left
          break
        case 2:
          value = raw + up
          break
        case 3:
          value = raw + ((left + up) >> 1)
          break
        case 4:
          value = raw + paeth(left, up, upLeft)
          break
        default:
          return null
      }
      out[dst + i] = value & 0xff
    }
  }
  return out
}

function rgbBytesToCMYK(rgb: Uint8Array, pixels: number, step: number, toCMYK: ToCMYK): Uint8Array {
  const out = new Uint8Array(pixels * 4)
  for (let p = 0; p < pixels; p++) {
    const cmyk = toCMYK(rgb[p * step] / 255, rgb[p * step + 1] / 255, rgb[p * step + 2] / 255)
    for (let c = 0; c < 4; c++) out[p * 4 + c] = Math.round(cmyk[c] * 255)
  }
  return out
}

function cmykImage(dict: string, cmyk: Uint8Array): PDFObject {
  let next = setDictValue(dict, 'ColorSpace', '/DeviceCMYK')
  next = setDictValue(next, 'Filter', '/FlateDecode')
  next = setDictValue(next, 'BitsPerComponent', '8')
  next = removeDictKey(next, 'DecodeParms')
  next = removeDictKey(next, 'Decode')
  return { dict: next, stream: deflateSync(cmyk) }
}

/** An indexed image's RGB palette, written as hex, as a CMYK one. */
function cmykPalette(space: string, toCMYK: ToCMYK): string | null {
  const match = /^\[\s*\/Indexed\s+\/DeviceRGB\s+(\d+)\s*<([0-9A-Fa-f\s]*)>\s*\]$/.exec(space)
  if (!match) return null
  const hex = match[2].replace(/\s+/g, '')
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  const cmyk = rgbBytesToCMYK(bytes, Math.floor(bytes.length / 3), 3, toCMYK)
  const out = [...cmyk].map((v) => v.toString(16).padStart(2, '0')).join('')
  return `[/Indexed /DeviceCMYK ${match[1]} <${out.toUpperCase()}>]`
}

/**
 * An RGB image XObject as a CMYK one, or null when it is not RGB or cannot be read: 8-bit Flate
 * data (with or without PNG predictors), indexed palettes, and DCT data `decode` reads, each
 * pixel through `toCMYK`.
 */
export function convertImage(
  object: PDFObject,
  decode?: PDFImageDecoder,
  toCMYK: ToCMYK = rgbToCMYK
): PDFObject | null {
  const { dict, stream } = object
  if (!stream) return null
  const space = dictValue(dict, 'ColorSpace') ?? ''
  if (space.startsWith('[') && space.includes('/Indexed')) {
    const palette = cmykPalette(space, toCMYK)
    return palette ? { dict: setDictValue(dict, 'ColorSpace', palette), stream } : null
  }
  if (space !== '/DeviceRGB') return null
  const width = Number(dictValue(dict, 'Width'))
  const height = Number(dictValue(dict, 'Height'))
  const filter = dictValue(dict, 'Filter') ?? ''
  if (filter === '/DCTDecode') {
    const decoded = decode?.(stream)
    if (!decoded) return null
    return cmykImage(dict, rgbBytesToCMYK(decoded.data, decoded.width * decoded.height, 4, toCMYK))
  }
  if (dictValue(dict, 'BitsPerComponent') !== '8') return null
  const data = flateSamples(dict, stream, width)
  if (!data || data.length < width * height * 3) return null
  return cmykImage(dict, rgbBytesToCMYK(data, width * height, 3, toCMYK))
}

/** An 8-bit image's samples, its Flate filter and PNG predictor undone. */
function flateSamples(dict: string, stream: Uint8Array, width: number): Uint8Array | null {
  const filter = dictValue(dict, 'Filter') ?? ''
  let data: Uint8Array
  if (filter === '/FlateDecode') data = inflateSync(stream)
  else if (filter === '') data = stream
  else return null
  const parms = dictValue(dict, 'DecodeParms') ?? ''
  const predictor = Number(dictValue(parms, 'Predictor') ?? 1)
  if (predictor === 1) return data
  if (predictor < 10) return null
  const columns = Number(dictValue(parms, 'Columns') ?? width)
  return unpredict(data, columns, Number(dictValue(parms, 'Colors') ?? 3))
}

export function isImage(object: PDFObject): boolean {
  return /\/Subtype\s*\/Image\b/.test(object.dict)
}
