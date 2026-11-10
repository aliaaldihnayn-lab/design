import { num } from './css'
import type { InspectColor, InspectSpec } from './spec'

function composeColor(color: InspectColor): string {
  const alpha = Math.round(color.opacity * 255)
    .toString(16)
    .padStart(2, '0')
    .toUpperCase()
  const name = color.variable ? ` /* ${color.variable.name} */` : ''
  return `Color(0x${alpha}${color.hex.slice(1)})${name}`
}

const dp = (value: number) => `${num(value)}.dp`
const sp = (value: number) => `${num(value)}.sp`
const bound = (value: number | null) => (value === null ? 'Dp.Unspecified' : dp(value))

function shapeOf(spec: InspectSpec): string {
  const radii = spec.radii
  if (!radii) return 'RectangleShape'
  if (radii.every((r) => r === radii[0])) return `RoundedCornerShape(${dp(radii[0])})`
  return `RoundedCornerShape(${radii.map(dp).join(', ')})`
}

function sizeModifiers(spec: InspectSpec): string[] {
  const { sizing } = spec
  const out: string[] = []
  if (sizing.width === 'fill') out.push('fillMaxWidth()')
  else if (sizing.width === 'fixed') out.push(`width(${dp(spec.width)})`)
  if (sizing.height === 'fill') out.push('fillMaxHeight()')
  else if (sizing.height === 'fixed') out.push(`height(${dp(spec.height)})`)
  if (sizing.minWidth !== null || sizing.maxWidth !== null)
    out.push(`widthIn(min = ${bound(sizing.minWidth)}, max = ${bound(sizing.maxWidth)})`)
  if (sizing.minHeight !== null || sizing.maxHeight !== null)
    out.push(`heightIn(min = ${bound(sizing.minHeight)}, max = ${bound(sizing.maxHeight)})`)
  return out
}

function paintModifiers(spec: InspectSpec): string[] {
  const out: string[] = []
  const shape = shapeOf(spec)
  if (spec.rotation !== 0) out.push(`rotate(${num(-spec.rotation)}f)`)
  for (const shadow of spec.shadows.filter((s) => !s.inner))
    out.push(`shadow(elevation = ${dp(shadow.blur / 2)}, shape = ${shape})`)
  const solid = spec.fills.find((p) => p.kind === 'solid')
  if (solid?.kind === 'solid') out.push(`background(${composeColor(solid)}, ${shape})`)
  const stroke = spec.strokes.at(0)
  if (stroke) out.push(`border(${dp(stroke.weight)}, ${composeColor(stroke)}, ${shape})`)
  if (spec.layout) {
    const [top, right, bottom, left] = spec.layout.padding
    if (top || right || bottom || left)
      out.push(
        `padding(start = ${dp(left)}, top = ${dp(top)}, end = ${dp(right)}, bottom = ${dp(bottom)})`
      )
  }
  if (spec.blur) out.push(`blur(${dp(spec.blur / 2)})`)
  if (spec.opacity < 1) out.push(`alpha(${num(spec.opacity)}f)`)
  return out
}

const TEXT_ALIGN = { left: 'Start', right: 'End', center: 'Center', justify: 'Justify' } as const

function text(t: NonNullable<InspectSpec['text']>, modifier: string): string {
  const family = t.family.toLowerCase().replace(/[^a-z0-9]+/g, '_')
  const args = [
    `text = ${JSON.stringify(t.content)}`,
    `modifier = ${modifier}`,
    `fontFamily = FontFamily(Font(R.font.${family}))`,
    `fontSize = ${sp(t.size)}`,
    `fontWeight = FontWeight(${t.weight})`
  ]
  if (t.italic) args.push('fontStyle = FontStyle.Italic')
  if (t.lineHeight !== null) args.push(`lineHeight = ${sp(t.lineHeight)}`)
  if (t.letterSpacing !== 0) args.push(`letterSpacing = ${sp(t.letterSpacing)}`)
  if (t.align !== 'left') args.push(`textAlign = TextAlign.${TEXT_ALIGN[t.align]}`)
  if (t.color) args.push(`color = ${composeColor(t.color)}`)
  return `Text(\n  ${args.join(',\n  ')}\n)`
}

const ROW_JUSTIFY = { start: 'Start', center: 'CenterHorizontally', end: 'End' } as const
const COLUMN_JUSTIFY = { start: 'Top', center: 'CenterVertically', end: 'Bottom' } as const
const ROW_ALIGN = {
  start: 'Top',
  end: 'Bottom',
  center: 'CenterVertically',
  stretch: 'Top',
  baseline: 'Top'
} as const
const COLUMN_ALIGN = {
  start: 'Start',
  end: 'End',
  center: 'CenterHorizontally',
  stretch: 'Start',
  baseline: 'Start'
} as const

function stack(layout: NonNullable<InspectSpec['layout']>, modifier: string): string {
  const row = layout.direction === 'row'
  const arrangement =
    layout.justify === 'space-between'
      ? 'Arrangement.SpaceBetween'
      : `Arrangement.spacedBy(${dp(layout.gap)}, Alignment.${(row ? ROW_JUSTIFY : COLUMN_JUSTIFY)[layout.justify]})`
  const alignment = `Alignment.${(row ? ROW_ALIGN : COLUMN_ALIGN)[layout.align]}`
  return [
    `${row ? 'Row' : 'Column'}(`,
    `  modifier = ${modifier},`,
    `  ${row ? 'horizontalArrangement' : 'verticalArrangement'} = ${arrangement},`,
    `  ${row ? 'verticalAlignment' : 'horizontalAlignment'} = ${alignment}`,
    ') {',
    '  // Children',
    '}'
  ].join('\n')
}

/** The layer as a Jetpack Compose call with its modifier chain. */
export function inspectCompose(spec: InspectSpec): string {
  const modifier = ['Modifier', ...sizeModifiers(spec), ...paintModifiers(spec)].join('\n    .')
  if (spec.text) return text(spec.text, modifier)
  if (spec.layout) return stack(spec.layout, modifier)
  return `Box(\n  modifier = ${modifier}\n)`
}
