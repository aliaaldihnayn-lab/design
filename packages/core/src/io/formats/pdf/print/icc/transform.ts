import { converter } from 'culori'
import { clamp } from 'es-toolkit'

import type { CMYK } from '#core/io/formats/pdf/print/color'

import type { ICCLut, ICCProfile, ICCRenderingIntent } from './profile'

/**
 * sRGB to a press profile's CMYK: the colour to CIE Lab or XYZ (D50, the profile connection
 * space), then through the profile's PCS-to-device table, as a colour-managed RIP converts it.
 */

const toLab = converter('lab')
const toXYZ = converter('xyz50')

/** A curve's value at `x` (0–1), between its nearest two entries. */
function curve(table: Float32Array, x: number): number {
  const at = clamp(x, 0, 1) * (table.length - 1)
  const i = Math.min(Math.floor(at), table.length - 2)
  const t = at - i
  return table[i] + (table[i + 1] - table[i]) * t
}

/** The table's device values for normalised 3-channel PCS input, by trilinear interpolation. */
function evaluate(lut: ICCLut, input: readonly [number, number, number]): number[] {
  const n = lut.gridPoints
  const outs = lut.outputChannels
  const xs = input.map((value, channel) => curve(lut.inputCurves[channel], value) * (n - 1))
  const base = xs.map((x) => Math.min(Math.floor(x), n - 2))
  const frac = xs.map((x, i) => x - base[i])
  const result = Array.from({ length: outs }, () => 0)
  for (let corner = 0; corner < 8; corner++) {
    let weight = 1
    let index = 0
    for (let axis = 0; axis < 3; axis++) {
      const high = (corner >> (2 - axis)) & 1
      weight *= high ? frac[axis] : 1 - frac[axis]
      index = index * n + base[axis] + high
    }
    if (weight === 0) continue
    for (let o = 0; o < outs; o++) result[o] += weight * lut.clut[index * outs + o]
  }
  return result.map((value, o) => curve(lut.outputCurves[o], value))
}

/** An sRGB colour as the table's normalised PCS input. */
function pcsInput(profile: ICCProfile, lut: ICCLut, r: number, g: number, b: number) {
  const rgb = { mode: 'rgb' as const, r, g, b }
  if (profile.pcs === 'Lab ') {
    const lab = toLab(rgb)
    const l = clamp(lab.l, 0, 100)
    const a = clamp(lab.a, -128, 127)
    const bb = clamp(lab.b, -128, 127)
    if (lut.precision === 8) return [l / 100, (a + 128) / 255, (bb + 128) / 255] as const
    // lut16Type keeps the version 2 Lab encoding: L 100 at 0xFF00, a and b 0 at 0x8000.
    const scale = 256 / 65535
    return [(l * 652.8) / 65535, (a + 128) * scale, (bb + 128) * scale] as const
  }
  const xyz = toXYZ(rgb)
  // XYZ is encoded as u1Fixed15, 1.0 at 0x8000; the table's matrix applies to it first.
  const encode = 32768 / 65535
  const v = [xyz.x * encode, xyz.y * encode, xyz.z * encode]
  const m = lut.matrix
  return [
    clamp(m[0] * v[0] + m[1] * v[1] + m[2] * v[2], 0, 1),
    clamp(m[3] * v[0] + m[4] * v[1] + m[5] * v[2], 0, 1),
    clamp(m[6] * v[0] + m[7] * v[1] + m[8] * v[2], 0, 1)
  ] as const
}

/** An ink amount, 0–1, with the interpolation's dust below a twentieth of a percent dropped. */
function ink(value: number): number {
  return value < 0.0005 ? 0 : clamp(value, 0, 1)
}

export type RGBToCMYK = (r: number, g: number, b: number) => CMYK

/** Grid points per axis of the cached sRGB-to-CMYK table images are converted through. */
const CACHE_POINTS = 33

/**
 * The profile's sRGB-to-CMYK conversion, or null when it is not a CMYK output profile with a
 * table this can read. Colours go through a 33³ grid of exact conversions, so converting the
 * pixels of an image costs a lookup each.
 */
export function createProfileTransform(
  profile: ICCProfile,
  intent: ICCRenderingIntent = 'perceptual'
): RGBToCMYK | null {
  if (profile.colorSpace !== 'CMYK') return null
  const lut =
    profile.toDevice[intent] ?? profile.toDevice.relative ?? profile.toDevice.perceptual ?? null
  if (lut?.inputChannels !== 3 || lut.outputChannels !== 4) return null
  const n = CACHE_POINTS
  let grid: Float32Array | null = null
  const build = () => {
    const table = new Float32Array(n * n * n * 4)
    for (let ri = 0; ri < n; ri++) {
      for (let gi = 0; gi < n; gi++) {
        for (let bi = 0; bi < n; bi++) {
          const out = evaluate(
            lut,
            pcsInput(profile, lut, ri / (n - 1), gi / (n - 1), bi / (n - 1))
          )
          table.set(out, ((ri * n + gi) * n + bi) * 4)
        }
      }
    }
    return table
  }
  const top = n - 2
  return (r, g, b) => {
    grid ??= build()
    // Scalars only: images convert millions of pixels through this.
    const xr = clamp(r, 0, 1) * (n - 1)
    const xg = clamp(g, 0, 1) * (n - 1)
    const xb = clamp(b, 0, 1) * (n - 1)
    const ir = Math.min(Math.floor(xr), top)
    const ig = Math.min(Math.floor(xg), top)
    const ib = Math.min(Math.floor(xb), top)
    const fr = xr - ir
    const fg = xg - ig
    const fb = xb - ib
    let c = 0
    let m = 0
    let y = 0
    let k = 0
    for (let corner = 0; corner < 8; corner++) {
      const hr = (corner >> 2) & 1
      const hg = (corner >> 1) & 1
      const hb = corner & 1
      const weight = (hr ? fr : 1 - fr) * (hg ? fg : 1 - fg) * (hb ? fb : 1 - fb)
      if (weight === 0) continue
      const index = (((ir + hr) * n + ig + hg) * n + ib + hb) * 4
      c += weight * grid[index]
      m += weight * grid[index + 1]
      y += weight * grid[index + 2]
      k += weight * grid[index + 3]
    }
    return [ink(c), ink(m), ink(y), ink(k)]
  }
}

/**
 * The exact conversion of one colour through the profile, without the cached grid; for tests
 * and for checking the grid against.
 */
export function profileColor(
  profile: ICCProfile,
  r: number,
  g: number,
  b: number,
  intent: ICCRenderingIntent = 'perceptual'
): CMYK | null {
  const lut = profile.toDevice[intent]
  if (lut?.inputChannels !== 3 || lut.outputChannels !== 4) return null
  const [c, m, y, k] = evaluate(lut, pcsInput(profile, lut, r, g, b))
  return [c, m, y, k]
}
