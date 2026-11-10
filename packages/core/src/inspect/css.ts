import type { InspectColor, InspectPaint, InspectShadow, InspectSpec } from './spec'

export const px = (value: number) => `${Math.round(value * 100) / 100}px`
export const num = (value: number) => `${Math.round(value * 100) / 100}`

/** A colour, through its variable when it has one, as Dev Mode writes `var(--name, #hex)`. */
function cssColor(color: InspectColor): string {
  return color.variable ? `var(--${color.variable.css}, ${color.css})` : color.css
}

function cssPaint(paint: InspectPaint): string | null {
  if (paint.kind === 'solid') return cssColor(paint)
  if (paint.kind === 'image') return null
  const stops = paint.stops.map((stop) => `${stop.css} ${num(stop.position * 100)}%`).join(', ')
  if (paint.type === 'linear') return `linear-gradient(180deg, ${stops})`
  if (paint.type === 'angular') return `conic-gradient(from 0deg, ${stops})`
  return `radial-gradient(50% 50% at 50% 50%, ${stops})`
}

function cssShadow(shadow: InspectShadow): string {
  const inset = shadow.inner ? 'inset ' : ''
  return `${inset}${px(shadow.x)} ${px(shadow.y)} ${px(shadow.blur)} ${px(shadow.spread)} ${cssColor(shadow)}`
}

type Declarations = [string, string][]

function sizeDeclarations(spec: InspectSpec): Declarations {
  const out: Declarations = []
  const { sizing } = spec
  if (sizing.width === 'hug') out.push(['width', 'fit-content'])
  else if (sizing.width === 'fill') out.push(['flex', '1 0 0'])
  else out.push(['width', px(spec.width)])
  if (sizing.height === 'hug') out.push(['height', 'fit-content'])
  else if (sizing.height === 'fill') out.push(['align-self', 'stretch'])
  else out.push(['height', px(spec.height)])
  const limits = [
    ['min-width', sizing.minWidth],
    ['max-width', sizing.maxWidth],
    ['min-height', sizing.minHeight],
    ['max-height', sizing.maxHeight]
  ] as const
  for (const [property, value] of limits) if (value !== null) out.push([property, px(value)])
  return out
}

const FLEX_ALIGN = {
  start: 'flex-start',
  end: 'flex-end',
  center: 'center',
  stretch: 'stretch',
  baseline: 'baseline',
  'space-between': 'space-between'
} as const

function layoutDeclarations(layout: NonNullable<InspectSpec['layout']>): Declarations {
  const out: Declarations = [
    ['display', 'flex'],
    ['flex-direction', layout.direction]
  ]
  if (layout.wrap) out.push(['flex-wrap', 'wrap'])
  out.push(
    ['justify-content', FLEX_ALIGN[layout.justify]],
    ['align-items', FLEX_ALIGN[layout.align]]
  )
  if (layout.gap) out.push(['gap', px(layout.gap)])
  if (layout.padding.some((p) => p > 0)) out.push(['padding', layout.padding.map(px).join(' ')])
  return out
}

function paintDeclarations(spec: InspectSpec): Declarations {
  const out: Declarations = []
  if (spec.radii) {
    const [a, b, c, d] = spec.radii
    out.push([
      'border-radius',
      a === b && b === c && c === d ? px(a) : spec.radii.map(px).join(' ')
    ])
  }
  const backgrounds = spec.fills.map(cssPaint).filter((value): value is string => value !== null)
  // CSS lists the top background first; Figma lists the top fill last.
  if (backgrounds.length > 0) out.push(['background', backgrounds.reverse().join(', ')])
  const shadows = spec.shadows.map(cssShadow)
  const stroke = spec.strokes.at(0)
  if (stroke?.align === 'inside')
    shadows.unshift(`inset 0 0 0 ${px(stroke.weight)} ${cssColor(stroke)}`)
  else if (stroke) out.push(['border', `${px(stroke.weight)} solid ${cssColor(stroke)}`])
  if (shadows.length > 0) out.push(['box-shadow', shadows.join(', ')])
  if (spec.blur) out.push(['filter', `blur(${px(spec.blur / 2)})`])
  if (spec.opacity < 1) out.push(['opacity', num(spec.opacity)])
  if (spec.rotation !== 0) out.push(['transform', `rotate(${num(-spec.rotation)}deg)`])
  return out
}

function textDeclarations(text: NonNullable<InspectSpec['text']>): Declarations {
  const out: Declarations = []
  if (text.color) out.push(['color', cssColor(text.color)])
  out.push(['font-family', `"${text.family}"`], ['font-size', px(text.size)])
  if (text.italic) out.push(['font-style', 'italic'])
  out.push(
    ['font-weight', String(text.weight)],
    ['line-height', text.lineHeight === null ? 'normal' : px(text.lineHeight)]
  )
  if (text.letterSpacing !== 0) out.push(['letter-spacing', px(text.letterSpacing)])
  if (text.align !== 'left') out.push(['text-align', text.align])
  return out
}

/** The layer as CSS declarations, one per line, as Dev Mode lists them. */
export function inspectCSS(spec: InspectSpec): string {
  return [
    ...sizeDeclarations(spec),
    ...(spec.layout ? layoutDeclarations(spec.layout) : []),
    ...paintDeclarations(spec),
    ...(spec.text ? textDeclarations(spec.text) : [])
  ]
    .map(([property, value]) => `${property}: ${value};`)
    .join('\n')
}
