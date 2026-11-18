import type { Fill } from '@lawha/scene-graph'
import { colorToCSS } from '@lawha/scene-graph/color'
import {
  gradientPoint,
  IDENTITY_GRADIENT_TRANSFORM,
  isGradientFill
} from '@lawha/scene-graph/gradient'
import type { Color, Vector } from '@lawha/scene-graph/primitives'

const round = (value: number, places = 2) => {
  const scale = 10 ** places
  return Math.round(value * scale) / scale
}

const degrees = (radians: number) => (radians * 180) / Math.PI

/** A gradient's geometry in the layer's unit square, as every code target draws it. */
export interface GradientGeometry {
  /** Where position 0 and position 1 fall, for linear gradients. */
  start: Vector
  end: Vector
  /** The centre, for radial, angular and diamond gradients. */
  center: Vector
  /** The radii along x and y, as fractions of the width and height. */
  radius: Vector
  /** CSS's angle for a linear gradient's direction or a conic gradient's start, clockwise from up. */
  angle: number
}

/**
 * Where a gradient fill's handles fall in the layer's unit square. Figma's gradient space runs
 * from (0, 0.5) to (1, 0.5) along a linear gradient, with the other kinds centred at (0.5, 0.5)
 * and reaching (1, 0.5) and (0.5, 1); `gradientTransform` maps the layer onto that space.
 */
export function gradientGeometry(fill: Fill, width: number, height: number): GradientGeometry {
  const transform = fill.gradientTransform ?? IDENTITY_GRADIENT_TRANSFORM
  const start = gradientPoint(transform, { x: 0, y: 0.5 })
  const end = gradientPoint(transform, { x: 1, y: 0.5 })
  const center = gradientPoint(transform, { x: 0.5, y: 0.5 })
  const edgeX = gradientPoint(transform, { x: 1, y: 0.5 })
  const edgeY = gradientPoint(transform, { x: 0.5, y: 1 })
  const w = Math.max(width, 1e-6)
  const h = Math.max(height, 1e-6)
  const span = (point: Vector) => Math.hypot((point.x - center.x) * w, (point.y - center.y) * h)
  const axis =
    fill.type === 'GRADIENT_LINEAR' ? { from: start, to: end } : { from: center, to: edgeX }
  const angle = degrees(Math.atan2((axis.to.x - axis.from.x) * w, -(axis.to.y - axis.from.y) * h))
  return {
    start,
    end,
    center,
    radius: { x: span(edgeX) / w, y: span(edgeY) / h },
    angle: (angle + 360) % 360
  }
}

const percent = (value: number) => `${round(value * 100)}%`

/**
 * The stops of a linear gradient placed on CSS's gradient line, which runs through the box's
 * centre at the gradient's angle and just reaches its corners, so the colours fall where Figma's
 * handles put them whatever the box's proportions.
 */
function linearStops(fill: Fill, geometry: GradientGeometry, width: number, height: number) {
  const theta = (geometry.angle * Math.PI) / 180
  const direction = { x: Math.sin(theta), y: -Math.cos(theta) }
  const length = Math.abs(width * direction.x) + Math.abs(height * direction.y) || 1
  const along = (point: Vector) =>
    ((point.x - 0.5) * width * direction.x + (point.y - 0.5) * height * direction.y) / length + 0.5
  const from = along(geometry.start)
  const to = along(geometry.end)
  return (fill.gradientStops ?? []).map((stop) => ({
    color: stop.color,
    at: from + (to - from) * stop.position
  }))
}

function stopList(fill: Fill, stops: { color: Color; at: number }[], unit: 'percent' | 'deg') {
  return stops
    .map((stop) => {
      const color = colorToCSS({ ...stop.color, a: round(stop.color.a * fill.opacity, 3) })
      const at = unit === 'deg' ? `${round(stop.at * 360)}deg` : percent(stop.at)
      return `${color} ${at}`
    })
    .join(', ')
}

/**
 * A gradient fill as a CSS image: `linear-gradient` with its angle and stops placed as drawn,
 * `radial-gradient` with its radii and centre, `conic-gradient` from its start angle, and a
 * diamond as the radial gradient nearest to it, which CSS has no shape for.
 */
export function gradientToCSS(fill: Fill, width: number, height: number): string | undefined {
  if (!fill.visible || !isGradientFill(fill.type) || !fill.gradientStops?.length) return undefined
  const geometry = gradientGeometry(fill, width, height)
  if (fill.type === 'GRADIENT_LINEAR') {
    const stops = linearStops(fill, geometry, width, height)
    return `linear-gradient(${round(geometry.angle)}deg, ${stopList(fill, stops, 'percent')})`
  }
  const at = `${percent(geometry.center.x)} ${percent(geometry.center.y)}`
  const stops = (fill.gradientStops ?? []).map((stop) => ({ color: stop.color, at: stop.position }))
  if (fill.type === 'GRADIENT_ANGULAR')
    return `conic-gradient(from ${round(geometry.angle)}deg at ${at}, ${stopList(fill, stops, 'deg')})`
  const radii = `${percent(geometry.radius.x)} ${percent(geometry.radius.y)}`
  return `radial-gradient(${radii} at ${at}, ${stopList(fill, stops, 'percent')})`
}

/** Every visible gradient fill as CSS background images, topmost first, as CSS lists them. */
export function gradientBackgrounds(
  fills: readonly Fill[],
  width: number,
  height: number
): string[] {
  return fills
    .map((fill) => gradientToCSS(fill, width, height))
    .filter((value): value is string => value !== undefined)
    .reverse()
}
