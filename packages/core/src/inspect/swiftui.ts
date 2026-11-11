import type { Vector } from '@lawha/scene-graph/primitives'

import { num } from './css'
import { topGradient, type InspectGradient } from './gradient'
import type { InspectColor, InspectSpec } from './spec'

function swiftColor(color: InspectColor): string {
  const name = color.variable ? `/* ${color.variable.name} */ ` : ''
  const opacity = color.opacity < 1 ? `.opacity(${num(color.opacity)})` : ''
  return `${name}Color(hex: 0x${color.hex.slice(1)})${opacity}`
}

const SWIFT_WEIGHTS = [
  'ultraLight',
  'thin',
  'light',
  'regular',
  'medium',
  'semibold',
  'bold',
  'heavy',
  'black'
] as const

/** SwiftUI's named weight nearest a CSS weight. */
function swiftWeight(weight: number): string {
  const index = Math.min(8, Math.max(0, Math.round(weight / 100) - 1))
  return SWIFT_WEIGHTS[index]
}

const ROW_ALIGN = {
  start: 'top',
  end: 'bottom',
  center: 'center',
  stretch: 'center',
  baseline: 'firstTextBaseline'
} as const
const COLUMN_ALIGN = {
  start: 'leading',
  end: 'trailing',
  center: 'center',
  stretch: 'center',
  baseline: 'leading'
} as const
const TEXT_ALIGN = {
  left: 'leading',
  right: 'trailing',
  center: 'center',
  justify: 'leading'
} as const

function view(spec: InspectSpec): string[] {
  if (spec.text) {
    const t = spec.text
    const lines = [
      `Text(${JSON.stringify(t.content)})`,
      `.font(.custom(${JSON.stringify(t.family)}, size: ${num(t.size)}).weight(.${swiftWeight(t.weight)}))`
    ]
    if (t.italic) lines.push('.italic()')
    if (t.letterSpacing !== 0) lines.push(`.kerning(${num(t.letterSpacing)})`)
    if (t.lineHeight !== null)
      lines.push(`.lineSpacing(${num(Math.max(0, t.lineHeight - t.size))})`)
    if (t.align !== 'left') lines.push(`.multilineTextAlignment(.${TEXT_ALIGN[t.align]})`)
    if (t.color) lines.push(`.foregroundStyle(${swiftColor(t.color)})`)
    return lines
  }
  if (!spec.layout) return ['Rectangle()']
  const { direction, gap, align, padding } = spec.layout
  const row = direction === 'row'
  const alignment = row ? ROW_ALIGN[align] : COLUMN_ALIGN[align]
  const lines = [
    `${row ? 'HStack' : 'VStack'}(alignment: .${alignment}, spacing: ${num(gap)}) {`,
    '  // Children',
    '}'
  ]
  const [top, right, bottom, left] = padding
  if (top || right || bottom || left)
    lines.push(
      `.padding(EdgeInsets(top: ${top}, leading: ${left}, bottom: ${bottom}, trailing: ${right}))`
    )
  return lines
}

function frames(spec: InspectSpec): string[] {
  const { sizing } = spec
  const lines: string[] = []
  const fill = (axis: 'width' | 'height') => (sizing[axis] === 'fill' ? '.infinity' : 'nil')
  const fixed = (axis: 'width' | 'height') =>
    sizing[axis] === 'fixed' ? num(axis === 'width' ? spec.width : spec.height) : 'nil'
  if (sizing.width === 'fill' || sizing.height === 'fill')
    lines.push(`.frame(maxWidth: ${fill('width')}, maxHeight: ${fill('height')})`)
  if (sizing.width === 'fixed' || sizing.height === 'fixed')
    lines.push(`.frame(width: ${fixed('width')}, height: ${fixed('height')})`)
  const limit = (value: number | null) => (value === null ? 'nil' : num(value))
  if (
    sizing.minWidth !== null ||
    sizing.maxWidth !== null ||
    sizing.minHeight !== null ||
    sizing.maxHeight !== null
  )
    lines.push(
      `.frame(minWidth: ${limit(sizing.minWidth)}, maxWidth: ${limit(sizing.maxWidth)}, minHeight: ${limit(sizing.minHeight)}, maxHeight: ${limit(sizing.maxHeight)})`
    )
  return lines
}

/** A gradient as SwiftUI's LinearGradient, RadialGradient or AngularGradient. */
function swiftGradient(gradient: InspectGradient, spec: InspectSpec): string {
  const stops = gradient.stops
    .map((stop) => {
      const opacity = stop.opacity < 1 ? `.opacity(${num(stop.opacity)})` : ''
      return `.init(color: Color(hex: 0x${stop.hex.slice(1)})${opacity}, location: ${num(stop.position)})`
    })
    .join(', ')
  const point = (p: Vector) => `UnitPoint(x: ${num(p.x)}, y: ${num(p.y)})`
  const g = gradient.geometry
  if (gradient.type === 'linear')
    return `LinearGradient(stops: [${stops}], startPoint: ${point(g.start)}, endPoint: ${point(g.end)})`
  if (gradient.type === 'angular')
    return `AngularGradient(stops: [${stops}], center: ${point(g.center)}, angle: .degrees(${num(g.angle - 90)}))`
  const radius = Math.max(g.radius.x * spec.width, g.radius.y * spec.height)
  return `RadialGradient(stops: [${stops}], center: ${point(g.center)}, startRadius: 0, endRadius: ${num(radius)})`
}

function decoration(spec: InspectSpec): string[] {
  const lines: string[] = []
  const radius = spec.radii?.[0] ?? 0
  const shape = `RoundedRectangle(cornerRadius: ${num(radius)})`
  const solid = spec.fills.find((p) => p.kind === 'solid')
  const gradient = topGradient(spec)
  if (gradient)
    lines.push(
      radius
        ? `.background(${swiftGradient(gradient, spec)}, in: ${shape})`
        : `.background(${swiftGradient(gradient, spec)})`
    )
  else if (solid?.kind === 'solid')
    lines.push(
      radius
        ? `.background(${swiftColor(solid)}, in: ${shape})`
        : `.background(${swiftColor(solid)})`
    )
  else if (radius) lines.push(`.clipShape(${shape})`)
  const stroke = spec.strokes.at(0)
  if (stroke)
    lines.push(`.overlay(${shape}.stroke(${swiftColor(stroke)}, lineWidth: ${num(stroke.weight)}))`)
  for (const shadow of spec.shadows.filter((s) => !s.inner))
    lines.push(
      `.shadow(color: ${swiftColor(shadow)}, radius: ${num(shadow.blur / 2)}, x: ${num(shadow.x)}, y: ${num(shadow.y)})`
    )
  if (spec.blur) lines.push(`.blur(radius: ${num(spec.blur / 2)})`)
  if (spec.opacity < 1) lines.push(`.opacity(${num(spec.opacity)})`)
  if (spec.rotation !== 0) lines.push(`.rotationEffect(.degrees(${num(-spec.rotation)}))`)
  return lines
}

/** The layer as a SwiftUI view with its modifiers. */
export function inspectSwiftUI(spec: InspectSpec): string {
  const [first, ...rest] = view(spec)
  const modifiers = [
    ...rest.filter((line) => line.startsWith('.')),
    ...frames(spec),
    ...decoration(spec)
  ]
  const body = [first, ...rest.filter((line) => !line.startsWith('.'))]
  return [...body, ...modifiers.map((line) => `  ${line}`)].join('\n')
}
