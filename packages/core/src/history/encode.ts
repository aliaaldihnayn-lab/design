import { fromUint8Array, toUint8Array } from 'js-base64'

/**
 * Version history stores a document as records of plain JSON text, so a snapshot can be hashed,
 * compared, written to IndexedDB or a file, and sent to a server the same way. Values JSON lacks
 * (byte arrays, maps, sets, `undefined` fields) are written as tagged objects and read back.
 */

const TAG = '$h'

type Tagged =
  | { $h: 'u8'; v: string }
  | { $h: 'f32'; v: number[] }
  | { $h: 'f64'; v: number[] }
  | { $h: 'map'; v: [unknown, unknown][] }
  | { $h: 'set'; v: unknown[] }
  | { $h: 'undef' }
  | { $h: 'nan' }
  | { $h: 'inf'; v: 1 | -1 }

function encodeNumber(value: number): unknown {
  if (Number.isNaN(value)) return { [TAG]: 'nan' }
  if (!Number.isFinite(value)) return { [TAG]: 'inf', v: value > 0 ? 1 : -1 }
  return value
}

function encodeInner(value: unknown): unknown {
  if (value === undefined) return { [TAG]: 'undef' }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return encodeNumber(value)
  if (value instanceof Uint8Array) return { [TAG]: 'u8', v: fromUint8Array(value) }
  if (value instanceof Float32Array) return { [TAG]: 'f32', v: Array.from(value) }
  if (value instanceof Float64Array) return { [TAG]: 'f64', v: Array.from(value) }
  if (value instanceof Map) {
    return {
      [TAG]: 'map',
      v: [...value].map(([key, item]) => [encodeInner(key), encodeInner(item)])
    }
  }
  if (value instanceof Set) return { [TAG]: 'set', v: [...value].map(encodeInner) }
  if (Array.isArray(value)) return value.map(encodeInner)
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {}
    // Keys are sorted so the same value always encodes, and hashes, the same.
    const entries = Object.entries(value).sort(([left], [right]) => (left < right ? -1 : 1))
    for (const [key, item] of entries) result[key] = encodeInner(item)
    return result
  }
  // Functions and symbols are not document data.
  return null
}

/** The canonical text of a value: equal values give equal text. */
export function encodeHistoryValue(value: unknown): string {
  return JSON.stringify(encodeInner(value))
}

function isTagged(value: object): value is Tagged {
  return TAG in value && typeof value[TAG] === 'string'
}

function decodeInner(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decodeInner)
  if (value === null || typeof value !== 'object') return value
  if (isTagged(value)) {
    switch (value.$h) {
      case 'u8':
        return toUint8Array(value.v)
      case 'f32':
        return Float32Array.from(value.v)
      case 'f64':
        return Float64Array.from(value.v)
      case 'map':
        return new Map(value.v.map(([key, item]) => [decodeInner(key), decodeInner(item)]))
      case 'set':
        return new Set(value.v.map(decodeInner))
      case 'undef':
        return undefined
      case 'nan':
        return Number.NaN
      case 'inf':
        return value.v * Number.POSITIVE_INFINITY
    }
  }
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) result[key] = decodeInner(item)
  return result
}

/** Reads text `encodeHistoryValue` wrote. */
export function decodeHistoryValue(text: string): unknown {
  const parsed: unknown = JSON.parse(text)
  return decodeInner(parsed)
}

/**
 * A 106-bit hash of text, two 53-bit halves of cyrb53 with different seeds, as hex. Records are
 * content-addressed by it, so a record unchanged between versions is stored once.
 */
export function hashHistoryText(text: string): string {
  return (
    half(text, 0x9e3779b9).toString(16).padStart(14, '0') +
    half(text, 0x85ebca6b).toString(16).padStart(14, '0')
  )
}

function half(text: string, seed: number): number {
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index)
    h1 = Math.imul(h1 ^ code, 2654435761)
    h2 = Math.imul(h2 ^ code, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507)
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507)
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return 4294967296 * (2097151 & h2) + (h1 >>> 0)
}
