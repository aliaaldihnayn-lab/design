import type { Vector } from '@lawha/scene-graph/primitives'

import type { InspectPaint, InspectSpec } from './spec'

export type InspectGradient = Extract<InspectPaint, { kind: 'gradient' }>

/** The layer's gradient fills, bottom first as Figma lists them. */
export function gradientsOf(spec: InspectSpec): InspectGradient[] {
  return spec.fills.filter((paint): paint is InspectGradient => paint.kind === 'gradient')
}

/** The top gradient fill, which native targets draw as the layer's background. */
export function topGradient(spec: InspectSpec): InspectGradient | undefined {
  return gradientsOf(spec).at(-1)
}

/** A point at `angle` (CSS degrees, clockwise from up) on a circle of `radius` around `center`. */
export function pointAt(center: Vector, angle: number, radius: number) {
  const theta = (angle * Math.PI) / 180
  return { x: center.x + Math.sin(theta) * radius, y: center.y - Math.cos(theta) * radius }
}
