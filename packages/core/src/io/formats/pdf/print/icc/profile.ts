/**
 * The parts of an ICC output profile a colour conversion needs: its header and the PCS-to-device
 * lookup tables (`B2A0`–`B2A2`) in the v2 `lut8Type` and `lut16Type` forms most press profiles
 * use (FOGRA39, FOGRA51, GRACoL, SWOP).
 */

export type ICCRenderingIntent = 'perceptual' | 'relative' | 'saturation'

/** A PCS-to-device table: optional matrix, input curves, a colour grid, and output curves. */
export interface ICCLut {
  inputChannels: number
  outputChannels: number
  gridPoints: number
  /** 3 × 3, row major; applied to XYZ input only. */
  matrix: number[]
  /** One curve per input channel, each 0–1. */
  inputCurves: Float32Array[]
  /** `gridPoints ** inputChannels` entries of `outputChannels` values, each 0–1. */
  clut: Float32Array
  /** One curve per output channel, each 0–1. */
  outputCurves: Float32Array[]
  /** `lut16Type` encodes Lab with L = 100 at 0xFF00; `lut8Type` at 0xFF. */
  precision: 8 | 16
}

export interface ICCProfile {
  /** `prtr` for an output (printer) profile. */
  deviceClass: string
  /** `CMYK` for a press profile. */
  colorSpace: string
  /** The profile connection space: `Lab ` or `XYZ `. */
  pcs: 'Lab ' | 'XYZ '
  version: number
  description: string
  /** PCS-to-device tables by rendering intent. */
  toDevice: Partial<Record<ICCRenderingIntent, ICCLut>>
}

const INTENT_TAGS: Record<ICCRenderingIntent, string> = {
  perceptual: 'B2A0',
  relative: 'B2A1',
  saturation: 'B2A2'
}

function tag(view: DataView, at: number): string {
  let out = ''
  for (let i = 0; i < 4; i++) out += String.fromCharCode(view.getUint8(at + i))
  return out
}

function s15Fixed16(view: DataView, at: number): number {
  return view.getInt32(at) / 65536
}

function readLut(view: DataView, at: number, size: number): ICCLut | null {
  const type = tag(view, at)
  if (type !== 'mft1' && type !== 'mft2') return null
  const precision = type === 'mft2' ? 16 : 8
  const inputChannels = view.getUint8(at + 8)
  const outputChannels = view.getUint8(at + 9)
  const gridPoints = view.getUint8(at + 10)
  if (inputChannels < 1 || outputChannels < 1 || gridPoints < 2) return null
  const matrix: number[] = []
  for (let i = 0; i < 9; i++) matrix.push(s15Fixed16(view, at + 12 + i * 4))
  let offset = at + 48
  let inputEntries = 256
  let outputEntries = 256
  if (precision === 16) {
    inputEntries = view.getUint16(offset)
    outputEntries = view.getUint16(offset + 2)
    offset += 4
  }
  const bytes = precision === 16 ? 2 : 1
  const max = precision === 16 ? 65535 : 255
  const clutEntries = gridPoints ** inputChannels * outputChannels
  const needed =
    offset -
    at +
    (inputChannels * inputEntries + clutEntries + outputChannels * outputEntries) * bytes
  if (needed > size || inputEntries < 2 || outputEntries < 2) return null
  const read = (count: number) => {
    const out = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      out[i] = (bytes === 2 ? view.getUint16(offset + i * 2) : view.getUint8(offset + i)) / max
    }
    offset += count * bytes
    return out
  }
  const inputCurves = Array.from({ length: inputChannels }, () => read(inputEntries))
  const clut = read(clutEntries)
  const outputCurves = Array.from({ length: outputChannels }, () => read(outputEntries))
  return {
    inputChannels,
    outputChannels,
    gridPoints,
    matrix,
    inputCurves,
    clut,
    outputCurves,
    precision
  }
}

function readDescription(view: DataView, at: number, size: number): string {
  const type = tag(view, at)
  if (type === 'desc') {
    const length = view.getUint32(at + 8)
    let out = ''
    for (let i = 0; i < length - 1 && 12 + i < size; i++) {
      out += String.fromCharCode(view.getUint8(at + 12 + i))
    }
    return out
  }
  if (type === 'mluc') {
    const records = view.getUint32(at + 8)
    if (records === 0) return ''
    const length = view.getUint32(at + 20)
    const start = at + view.getUint32(at + 24)
    let out = ''
    for (let i = 0; i + 1 < length; i += 2) out += String.fromCharCode(view.getUint16(start + i))
    return out
  }
  return ''
}

/** The profile's header and PCS-to-device tables, or null when it is not an ICC profile. */
export function parseICCProfile(bytes: Uint8Array): ICCProfile | null {
  if (bytes.length < 132) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (tag(view, 36) !== 'acsp') return null
  const pcs = tag(view, 20)
  if (pcs !== 'Lab ' && pcs !== 'XYZ ') return null
  const count = view.getUint32(128)
  const tags = new Map<string, { offset: number; size: number }>()
  for (let i = 0; i < count; i++) {
    const at = 132 + i * 12
    if (at + 12 > bytes.length) return null
    const offset = view.getUint32(at + 4)
    const size = view.getUint32(at + 8)
    if (offset + size > bytes.length) continue
    tags.set(tag(view, at), { offset, size })
  }
  const toDevice: ICCProfile['toDevice'] = {}
  for (const [intent, name] of Object.entries(INTENT_TAGS) as [ICCRenderingIntent, string][]) {
    const entry = tags.get(name)
    const lut = entry ? readLut(view, entry.offset, entry.size) : null
    if (lut) toDevice[intent] = lut
  }
  const desc = tags.get('desc')
  return {
    deviceClass: tag(view, 12),
    colorSpace: tag(view, 16),
    pcs,
    version: view.getUint8(8),
    description: desc ? readDescription(view, desc.offset, desc.size) : '',
    toDevice
  }
}
