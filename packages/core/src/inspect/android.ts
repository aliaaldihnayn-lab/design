import { num } from './css'
import { topGradient, type InspectGradient } from './gradient'
import type { InspectColor, InspectSpec } from './spec'

const dp = (value: number) => `${num(value)}dp`
const sp = (value: number) => `${num(value)}sp`

/** Android's `#AARRGGBB`. */
function androidColor(color: Pick<InspectColor, 'hex' | 'opacity'>): string {
  const alpha = Math.round(color.opacity * 255)
    .toString(16)
    .padStart(2, '0')
    .toUpperCase()
  return `#${alpha}${color.hex.slice(1)}`
}

function escapeXML(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

/** A resource name from a layer name: lowercase letters, digits and underscores. */
function resourceName(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return /^[a-z]/.test(base) ? base : `layer_${base}`
}

function size(spec: InspectSpec, axis: 'width' | 'height'): string {
  const sizing = spec.sizing[axis]
  if (sizing === 'hug') return 'wrap_content'
  if (sizing === 'fill') return 'match_parent'
  return dp(axis === 'width' ? spec.width : spec.height)
}

const GRAVITY = { start: 'start', center: 'center', end: 'end', stretch: 'fill', baseline: 'start' }
const TEXT_GRAVITY = { left: 'start', center: 'center_horizontal', right: 'end', justify: 'start' }

/**
 * A `<gradient>` element: Android's angle runs counter-clockwise from left to right in steps of
 * 45, and a drawable gradient holds a start, centre and end colour, so more stops keep the
 * first, middle and last.
 */
function gradientElement(gradient: InspectGradient, spec: InspectSpec): string[] {
  const { stops, geometry } = gradient
  const first = stops.at(0)
  const last = stops.at(-1)
  if (!first || !last) return []
  const attrs: string[] = []
  if (gradient.type === 'linear') {
    const angle = (((90 - geometry.angle) % 360) + 360) % 360
    attrs.push('android:type="linear"', `android:angle="${(Math.round(angle / 45) * 45) % 360}"`)
  } else {
    attrs.push(`android:type="${gradient.type === 'angular' ? 'sweep' : 'radial'}"`)
    attrs.push(
      `android:centerX="${num(geometry.center.x)}"`,
      `android:centerY="${num(geometry.center.y)}"`
    )
    if (gradient.type !== 'angular')
      attrs.push(
        `android:gradientRadius="${dp(Math.max(geometry.radius.x * spec.width, geometry.radius.y * spec.height))}"`
      )
  }
  attrs.push(`android:startColor="${androidColor(first)}"`)
  if (stops.length > 2)
    attrs.push(`android:centerColor="${androidColor(stops[Math.floor(stops.length / 2)])}"`)
  attrs.push(`android:endColor="${androidColor(last)}"`)
  const lines = [`    <gradient`, ...attrs.map((attr) => `        ${attr}`)]
  lines[lines.length - 1] += ' />'
  if (stops.length > 3) lines.unshift(`    <!-- ${stops.length} stops: Android keeps three -->`)
  return lines
}

/** The layer's background drawable, when it paints a fill, stroke or corner. */
function drawable(spec: InspectSpec): string[] | null {
  const gradient = topGradient(spec)
  const solid = spec.fills.findLast((paint) => paint.kind === 'solid')
  const stroke = spec.strokes.at(0)
  if (!gradient && !solid && !stroke && !spec.radii) return null
  const lines = [
    '<shape xmlns:android="http://schemas.android.com/apk/res/android"',
    '    android:shape="rectangle">'
  ]
  if (spec.radii) {
    const [tl, tr, br, bl] = spec.radii
    lines.push(
      tl === tr && tr === br && br === bl
        ? `    <corners android:radius="${dp(tl)}" />`
        : `    <corners android:topLeftRadius="${dp(tl)}" android:topRightRadius="${dp(tr)}" android:bottomRightRadius="${dp(br)}" android:bottomLeftRadius="${dp(bl)}" />`
    )
  }
  if (gradient) lines.push(...gradientElement(gradient, spec))
  else if (solid?.kind === 'solid')
    lines.push(`    <solid android:color="${androidColor(solid)}" />`)
  if (stroke)
    lines.push(
      `    <stroke android:width="${dp(stroke.weight)}" android:color="${androidColor(stroke)}" />`
    )
  lines.push('</shape>')
  return lines
}

function textAttributes(text: NonNullable<InspectSpec['text']>): string[] {
  const family = text.family.toLowerCase().replace(/[^a-z0-9]+/g, '_')
  const out = [
    `android:text="${escapeXML(text.content)}"`,
    `android:textSize="${sp(text.size)}"`,
    `android:fontFamily="@font/${family}"`,
    `android:textFontWeight="${text.weight}"`
  ]
  if (text.italic) out.push('android:textStyle="italic"')
  if (text.color) out.push(`android:textColor="${androidColor(text.color)}"`)
  if (text.lineHeight !== null) out.push(`android:lineHeight="${sp(text.lineHeight)}"`)
  if (text.letterSpacing !== 0)
    out.push(`android:letterSpacing="${num(text.letterSpacing / text.size)}"`)
  if (text.align !== 'left') out.push(`android:gravity="${TEXT_GRAVITY[text.align]}"`)
  return out
}

function layoutAttributes(layout: NonNullable<InspectSpec['layout']>): string[] {
  const attrs: string[] = []
  const { direction, padding, justify, align } = layout
  attrs.push(`android:orientation="${direction === 'row' ? 'horizontal' : 'vertical'}"`)
  const main = justify === 'space-between' ? 'start' : justify
  const [mainAxis, crossAxis] =
    direction === 'row' ? ['horizontal', 'vertical'] : ['vertical', 'horizontal']
  attrs.push(
    `android:gravity="${main === 'center' ? `center_${mainAxis}` : main}|${align === 'center' ? `center_${crossAxis}` : GRAVITY[align]}"`
  )
  const [top, right, bottom, left] = padding
  if (top || right || bottom || left)
    attrs.push(
      `android:paddingStart="${dp(left)}"`,
      `android:paddingTop="${dp(top)}"`,
      `android:paddingEnd="${dp(right)}"`,
      `android:paddingBottom="${dp(bottom)}"`
    )
  return attrs
}

/**
 * The layer as an Android View in layout XML: a TextView for text, a LinearLayout for auto
 * layout, otherwise a View, sized in dp and sp, with its background as a shape drawable.
 */
export function inspectAndroidXML(spec: InspectSpec): string {
  const name = resourceName(spec.name)
  const background = drawable(spec)
  let tag = 'View'
  if (spec.text) tag = 'TextView'
  else if (spec.layout) tag = 'LinearLayout'
  const attrs = [
    'xmlns:android="http://schemas.android.com/apk/res/android"',
    `android:id="@+id/${name}"`,
    `android:layout_width="${size(spec, 'width')}"`,
    `android:layout_height="${size(spec, 'height')}"`
  ]
  const { minWidth, minHeight } = spec.sizing
  if (minWidth !== null) attrs.push(`android:minWidth="${dp(minWidth)}"`)
  if (minHeight !== null) attrs.push(`android:minHeight="${dp(minHeight)}"`)
  if (spec.text) attrs.push(...textAttributes(spec.text))
  if (spec.layout) attrs.push(...layoutAttributes(spec.layout))
  if (background) attrs.push(`android:background="@drawable/${name}_background"`)
  const shadow = spec.shadows.find((item) => !item.inner)
  if (shadow) attrs.push(`android:elevation="${dp(shadow.blur / 2)}"`)
  if (spec.opacity < 1) attrs.push(`android:alpha="${num(spec.opacity)}"`)
  if (spec.rotation !== 0) attrs.push(`android:rotation="${num(-spec.rotation)}"`)

  const lines = [`<!-- res/layout: ${escapeXML(spec.name)} -->`, `<${tag}`]
  lines.push(...attrs.map((attr) => `    ${attr}`))
  if (spec.layout) {
    lines[lines.length - 1] += '>'
    if (spec.layout.gap)
      lines.push(`    <!-- ${dp(spec.layout.gap)} between children: give them that margin -->`)
    lines.push(`</${tag}>`)
  } else lines[lines.length - 1] += ' />'
  if (background) lines.push('', `<!-- res/drawable/${name}_background.xml -->`, ...background)
  return lines.join('\n')
}
