import { compact } from 'es-toolkit/array'

import type { Vector } from '@lawha/scene-graph/primitives'

import { num } from './css'
import { pointAt, topGradient, type InspectGradient } from './gradient'
import type { InspectColor, InspectSpec } from './spec'

/** A UIColor from `#RRGGBB` and its opacity, noting the variable it is bound to. */
function uiColor(
  color: Pick<InspectColor, 'hex' | 'opacity'> & { variable?: InspectColor['variable'] }
) {
  const channel = (offset: number) =>
    num(Number.parseInt(color.hex.slice(offset, offset + 2), 16) / 255)
  const name = color.variable ? ` /* ${color.variable.name} */` : ''
  return `UIColor(red: ${channel(1)}, green: ${channel(3)}, blue: ${channel(5)}, alpha: ${num(color.opacity)})${name}`
}

const UI_WEIGHTS = [
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

function uiWeight(weight: number): string {
  return UI_WEIGHTS[Math.min(8, Math.max(0, Math.round(weight / 100) - 1))]
}

const STACK_ALIGN = {
  start: 'leading',
  center: 'center',
  end: 'trailing',
  stretch: 'fill',
  baseline: 'firstBaseline'
} as const
const ROW_STACK_ALIGN = { ...STACK_ALIGN, start: 'top', end: 'bottom' } as const
const TEXT_ALIGN = { left: 'left', center: 'center', right: 'right', justify: 'justified' } as const

/** Variable names in Swift: lower camel case from the layer's name. */
function swiftName(name: string): string {
  const words = compact(name.split(/[^A-Za-z0-9]+/))
  const camel = words
    .map((word, index) =>
      index === 0 ? word.toLowerCase() : word[0].toUpperCase() + word.slice(1).toLowerCase()
    )
    .join('')
  return /^[a-z]/.test(camel) ? camel : `layer${camel}`
}

/** A CAGradientLayer: axial with Figma's handles, radial to its radius, or conic from its angle. */
function gradientLayer(gradient: InspectGradient, view: string, radius: number): string[] {
  const g = gradient.geometry
  const point = (p: Vector) => `CGPoint(x: ${num(p.x)}, y: ${num(p.y)})`
  const type = { linear: '.axial', radial: '.radial', diamond: '.radial', angular: '.conic' }[
    gradient.type
  ]
  let start = g.start
  let end = g.end
  if (gradient.type === 'radial' || gradient.type === 'diamond') {
    start = g.center
    end = { x: g.center.x + g.radius.x, y: g.center.y + g.radius.y }
  } else if (gradient.type === 'angular') {
    start = g.center
    end = pointAt(g.center, g.angle, 0.5)
  }
  const lines = [
    'let gradient = CAGradientLayer()',
    `gradient.type = ${type}`,
    `gradient.colors = [${gradient.stops.map((stop) => `${uiColor(stop)}.cgColor`).join(', ')}]`,
    `gradient.locations = [${gradient.stops.map((stop) => num(stop.position)).join(', ')}]`,
    `gradient.startPoint = ${point(start)}`,
    `gradient.endPoint = ${point(end)}`,
    `gradient.frame = ${view}.bounds`
  ]
  if (radius) lines.push(`gradient.cornerRadius = ${num(radius)}`)
  lines.push(`${view}.layer.insertSublayer(gradient, at: 0)`)
  return lines
}

function constraints(spec: InspectSpec, view: string): string[] {
  const { sizing } = spec
  const out: string[] = [`${view}.translatesAutoresizingMaskIntoConstraints = false`]
  const anchor = (axis: 'width' | 'height', relation: string, value: number) =>
    `${view}.${axis}Anchor.constraint(${relation}: ${num(value)}).isActive = true`
  if (sizing.width === 'fixed') out.push(anchor('width', 'equalToConstant', spec.width))
  if (sizing.height === 'fixed') out.push(anchor('height', 'equalToConstant', spec.height))
  if (sizing.minWidth !== null)
    out.push(anchor('width', 'greaterThanOrEqualToConstant', sizing.minWidth))
  if (sizing.maxWidth !== null)
    out.push(anchor('width', 'lessThanOrEqualToConstant', sizing.maxWidth))
  if (sizing.minHeight !== null)
    out.push(anchor('height', 'greaterThanOrEqualToConstant', sizing.minHeight))
  if (sizing.maxHeight !== null)
    out.push(anchor('height', 'lessThanOrEqualToConstant', sizing.maxHeight))
  if (sizing.width === 'fill' || sizing.height === 'fill')
    out.push(`// Fills its stack: give it the stack's .fill distribution or alignment.`)
  return out
}

function label(text: NonNullable<InspectSpec['text']>, view: string): string[] {
  const lines = [
    `let ${view} = UILabel()`,
    `${view}.text = ${JSON.stringify(text.content)}`,
    `${view}.font = UIFont(name: ${JSON.stringify(text.family)}, size: ${num(text.size)}) ?? .systemFont(ofSize: ${num(text.size)}, weight: .${uiWeight(text.weight)})`,
    `${view}.numberOfLines = 0`
  ]
  if (text.color) lines.push(`${view}.textColor = ${uiColor(text.color)}`)
  if (text.align !== 'left') lines.push(`${view}.textAlignment = .${TEXT_ALIGN[text.align]}`)
  if (text.lineHeight !== null || text.letterSpacing !== 0) {
    lines.push('let paragraph = NSMutableParagraphStyle()')
    if (text.lineHeight !== null) {
      lines.push(`paragraph.minimumLineHeight = ${num(text.lineHeight)}`)
      lines.push(`paragraph.maximumLineHeight = ${num(text.lineHeight)}`)
    }
    lines.push(
      `${view}.attributedText = NSAttributedString(string: ${view}.text ?? "", attributes: [.paragraphStyle: paragraph, .kern: ${num(text.letterSpacing)}])`
    )
  }
  return lines
}

function stack(layout: NonNullable<InspectSpec['layout']>, view: string): string[] {
  const row = layout.direction === 'row'
  const [top, right, bottom, left] = layout.padding
  const lines = [
    `let ${view} = UIStackView()`,
    `${view}.axis = .${row ? 'horizontal' : 'vertical'}`,
    `${view}.spacing = ${num(layout.gap)}`,
    `${view}.alignment = .${(row ? ROW_STACK_ALIGN : STACK_ALIGN)[layout.align]}`,
    `${view}.distribution = .${layout.justify === 'space-between' ? 'equalSpacing' : 'fill'}`
  ]
  if (top || right || bottom || left)
    lines.push(
      `${view}.isLayoutMarginsRelativeArrangement = true`,
      `${view}.directionalLayoutMargins = NSDirectionalEdgeInsets(top: ${num(top)}, leading: ${num(left)}, bottom: ${num(bottom)}, trailing: ${num(right)})`
    )
  lines.push('// Children: addArrangedSubview(_:)')
  return lines
}

/**
 * The layer as UIKit code: a UILabel for text, a UIStackView for auto layout, otherwise a
 * UIView, with layer styling (corners, border, shadow), gradients as a CAGradientLayer, and
 * sizes as Auto Layout constraints.
 */
export function inspectUIKit(spec: InspectSpec): string {
  const view = swiftName(spec.name)
  const lines: string[] = [`let ${view} = UIView()`]
  if (spec.text) lines.splice(0, 1, ...label(spec.text, view))
  else if (spec.layout) lines.splice(0, 1, ...stack(spec.layout, view))
  lines.push(...constraints(spec, view))
  const radius = spec.radii?.[0] ?? 0
  const gradient = topGradient(spec)
  const solid = spec.fills.findLast((paint) => paint.kind === 'solid')
  if (solid?.kind === 'solid' && !gradient)
    lines.push(`${view}.backgroundColor = ${uiColor(solid)}`)
  if (spec.radii) {
    lines.push(`${view}.layer.cornerRadius = ${num(radius)}`)
    if (spec.radii.some((r) => r !== radius))
      lines.push(`// Corners differ (${spec.radii.map(num).join(', ')}): mask with a UIBezierPath`)
  }
  const stroke = spec.strokes.at(0)
  if (stroke)
    lines.push(
      `${view}.layer.borderWidth = ${num(stroke.weight)}`,
      `${view}.layer.borderColor = ${uiColor(stroke)}.cgColor`
    )
  const shadow = spec.shadows.find((item) => !item.inner)
  if (shadow)
    lines.push(
      `${view}.layer.shadowColor = ${uiColor({ ...shadow, opacity: 1 })}.cgColor`,
      `${view}.layer.shadowOpacity = ${num(shadow.opacity)}`,
      `${view}.layer.shadowOffset = CGSize(width: ${num(shadow.x)}, height: ${num(shadow.y)})`,
      `${view}.layer.shadowRadius = ${num(shadow.blur / 2)}`
    )
  if (spec.opacity < 1) lines.push(`${view}.alpha = ${num(spec.opacity)}`)
  if (spec.rotation !== 0)
    lines.push(
      `${view}.transform = CGAffineTransform(rotationAngle: ${num(-spec.rotation)} * .pi / 180)`
    )
  if (gradient) {
    lines.push('// Once laid out, in layoutSubviews():')
    lines.push(...gradientLayer(gradient, view, radius))
  }
  return lines.join('\n')
}
