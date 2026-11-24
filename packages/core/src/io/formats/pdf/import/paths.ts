import { n, type Matrix } from './text'

/** The PDF operators pdf.js numbers, by name. */
export interface PDFOps {
  [name: string]: number
}

export function invert(m: Matrix): Matrix | null {
  const det = m[0] * m[3] - m[1] * m[2]
  if (!det) return null
  return [
    m[3] / det,
    -m[1] / det,
    -m[2] / det,
    m[0] / det,
    (m[2] * m[5] - m[3] * m[4]) / det,
    (m[1] * m[4] - m[0] * m[5]) / det
  ]
}

export function rgb(args: ArrayLike<number> | string): string {
  if (typeof args === 'string') return args
  const hex = (value: number) =>
    Math.max(0, Math.min(255, Math.round(value)))
      .toString(16)
      .padStart(2, '0')
  return `#${hex(args[0])}${hex(args[1])}${hex(args[2])}`
}

/** pdf.js passes an RGB colour as its three channels, or a hex string in newer builds. */
export function colourArgs(args: unknown[] | ArrayLike<number>): ArrayLike<number> | string {
  const first: unknown = Array.isArray(args) ? args[0] : undefined
  if (typeof first === 'string') return first
  return args as ArrayLike<number>
}

export function gray(value: number): string {
  const v = Math.round(value * 255)
  return rgb([v, v, v])
}

/** CMYK to sRGB the naive way PDF viewers use without a colour profile. */
export function cmyk(c: number, m: number, y: number, k: number): string {
  return rgb([255 * (1 - c) * (1 - k), 255 * (1 - m) * (1 - k), 255 * (1 - y) * (1 - k)])
}

export const LINE_CAPS = ['butt', 'round', 'square']
export const LINE_JOINS = ['miter', 'round', 'bevel']

export interface BuiltPath {
  d: string
  /** The path's single rectangle, when it is one: x, y, width, height. */
  rect: [number, number, number, number] | null
}

export function buildPath(
  ops: PDFOps,
  codes: ArrayLike<number>,
  args: ArrayLike<number>
): BuiltPath {
  const d: string[] = []
  let rect: BuiltPath['rect'] = null
  let shapes = 0
  let j = 0
  let x = 0
  let y = 0
  for (const code of Array.from(codes)) {
    if (code === ops.rectangle) {
      const [rx, ry, w, h] = [args[j++], args[j++], args[j++], args[j++]]
      d.push(`M${n(rx)} ${n(ry)}h${n(w)}v${n(h)}h${n(-w)}Z`)
      rect = [rx, ry, w, h]
      shapes++
      x = rx
      y = ry
    } else if (code === ops.moveTo) {
      x = args[j++]
      y = args[j++]
      d.push(`M${n(x)} ${n(y)}`)
      shapes += 2
    } else if (code === ops.lineTo) {
      x = args[j++]
      y = args[j++]
      d.push(`L${n(x)} ${n(y)}`)
    } else if (code === ops.curveTo) {
      const c = [args[j++], args[j++], args[j++], args[j++], args[j++], args[j++]]
      d.push(`C${c.map(n).join(' ')}`)
      x = c[4]
      y = c[5]
    } else if (code === ops.curveTo2) {
      // First control point is the current point.
      const c = [args[j++], args[j++], args[j++], args[j++]]
      d.push(`C${n(x)} ${n(y)} ${c.map(n).join(' ')}`)
      x = c[2]
      y = c[3]
    } else if (code === ops.curveTo3) {
      // Second control point is the end point.
      const c = [args[j++], args[j++], args[j++], args[j++]]
      d.push(`C${n(c[0])} ${n(c[1])} ${n(c[2])} ${n(c[3])} ${n(c[2])} ${n(c[3])}`)
      x = c[2]
      y = c[3]
    } else if (code === ops.closePath) {
      d.push('Z')
    }
  }
  return { d: d.join(''), rect: shapes === 1 ? rect : null }
}
