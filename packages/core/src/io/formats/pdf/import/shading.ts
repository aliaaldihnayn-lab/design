import type { Matrix } from './text'

/**
 * A PDF shading as an SVG gradient. pdf.js hands shadings over as its own representation:
 * axial and radial shadings with their colour stops, and meshes (Illustrator's gradient meshes
 * and freeform gradients) as triangles of colours, which a layer's paint cannot hold, so they
 * fill with their average colour.
 */
export interface ShadingPaint {
  /** Shading space to page space. */
  transform: Matrix
  /** A single colour standing in for the shading, such as for text. */
  colour: string
  /** The gradient's definition under `id`, positioned by `gradientTransform`. */
  markup(id: string, gradientTransform: string): string
}

const n = (value: number) => String(Math.round(value * 10000) / 10000)

function isPoint(value: unknown): value is [number, number] {
  return Array.isArray(value) && typeof value[0] === 'number' && typeof value[1] === 'number'
}

function stopsOf(value: unknown): [number, string][] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (stop): stop is [number, string] =>
      Array.isArray(stop) && typeof stop[0] === 'number' && typeof stop[1] === 'string'
  )
}

function stopMarkup(stops: [number, string][], offset = (t: number) => t): string {
  return stops
    .map(
      ([t, colour]) =>
        `<stop offset="${n(Math.min(1, Math.max(0, offset(t))))}" stop-color="${colour}"/>`
    )
    .join('')
}

function hex(r: number, g: number, b: number): string {
  const channel = (value: number) =>
    Math.max(0, Math.min(255, Math.round(value)))
      .toString(16)
      .padStart(2, '0')
  return `#${channel(r)}${channel(g)}${channel(b)}`
}

/** A mesh's average colour, from its packed RGB vertex colours. */
function meshColour(colours: unknown): string | null {
  if (!colours || typeof colours !== 'object' || !('length' in colours)) return null
  const values = Array.from(colours as ArrayLike<number>)
  if (values.length < 3) return null
  const stride = values.length % 4 === 0 ? 4 : 3
  const sum = [0, 0, 0]
  for (let i = 0; i + 2 < values.length; i += stride) {
    sum[0] += values[i]
    sum[1] += values[i + 1]
    sum[2] += values[i + 2]
  }
  const vertices = Math.floor(values.length / stride)
  return hex(sum[0] / vertices, sum[1] / vertices, sum[2] / vertices)
}

export function shadingPaint(ir: unknown, transform: Matrix): ShadingPaint | null {
  if (!Array.isArray(ir)) return null
  if (ir[0] === 'Mesh') {
    const colour = meshColour(ir[3])
    if (!colour) return null
    return {
      transform,
      colour,
      markup: (id) =>
        `<linearGradient id="${id}"><stop offset="0" stop-color="${colour}"/><stop offset="1" stop-color="${colour}"/></linearGradient>`
    }
  }
  if (ir[0] !== 'RadialAxial') return null
  const stops = stopsOf(ir[3])
  const [, type, , , p0, p1] = ir as unknown[]
  if (stops.length === 0 || !isPoint(p0) || !isPoint(p1)) return null
  const colour = stops[0][1]
  if (type === 'axial') {
    return {
      transform,
      colour,
      markup: (id, gradientTransform) =>
        `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${n(p0[0])}" y1="${n(p0[1])}" x2="${n(p1[0])}" y2="${n(p1[1])}" gradientTransform="${gradientTransform}">${stopMarkup(stops)}</linearGradient>`
    }
  }
  const r0 = typeof ir[6] === 'number' ? ir[6] : 0
  const r1 = typeof ir[7] === 'number' ? ir[7] : 0
  if (!(r1 > 0)) return null
  // SVG's radial gradient starts at its centre; a PDF one may start at a circle around it.
  const offset = (t: number) => (r0 + t * (r1 - r0)) / r1
  return {
    transform,
    colour,
    markup: (id, gradientTransform) =>
      `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${n(p1[0])}" cy="${n(p1[1])}" r="${n(r1)}" gradientTransform="${gradientTransform}">${stopMarkup(stops, offset)}</radialGradient>`
  }
}
