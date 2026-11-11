import type { SceneGraph, SceneNode } from '@lawha/scene-graph'
import { colorToCSS } from '@lawha/scene-graph/color'
import type { Vector } from '@lawha/scene-graph/primitives'

import type { OverlayState } from './engine'
import type { LayerState } from './smart-animate'

/**
 * A layer Smart Animate can draw from its geometry, as Figma does, rather than by stretching an
 * image of it: a box with a solid fill, corners, one solid stroke and shadows, which the player
 * draws and tweens property by property, so corners stay round and strokes keep their width
 * while it resizes. Values are in screen units.
 */
export interface GeometryStyle {
  x: number
  y: number
  width: number
  height: number
  /** Top left, top right, bottom right, bottom left. */
  radii: [number, number, number, number]
  /** The fill as CSS, or null for none. */
  fill: string | null
  stroke: { weight: number; color: string; align: 'inside' | 'center' | 'outside' } | null
  shadows: { x: number; y: number; blur: number; spread: number; color: string; inner: boolean }[]
  opacity: number
}

const BOX_TYPES = new Set<SceneNode['type']>([
  'FRAME',
  'RECTANGLE',
  'ELLIPSE',
  'COMPONENT',
  'INSTANCE'
])

const STROKE_ALIGN = { INSIDE: 'inside', OUTSIDE: 'outside', CENTER: 'center' } as const

function cornerRadii(node: SceneNode, state: LayerState): GeometryStyle['radii'] {
  if (node.type === 'ELLIPSE') {
    const round = Math.max(state.width, state.height) / 2
    return [round, round, round, round]
  }
  if (node.independentCorners)
    return [node.topLeftRadius, node.topRightRadius, node.bottomRightRadius, node.bottomLeftRadius]
  return [node.cornerRadius, node.cornerRadius, node.cornerRadius, node.cornerRadius]
}

/** Every visible layer inside `node` is one Smart Animate draws on its own. */
function childrenDrawnApart(graph: SceneGraph, node: SceneNode, apart: ReadonlySet<string>) {
  return node.childIds.every((id) => {
    const child = graph.getNode(id)
    return !child?.visible || apart.has(id)
  })
}

/**
 * The layer's geometry, when it is a box CSS draws exactly; null when it needs its image (text,
 * vectors, images, gradients, blurs, rotation, or children Smart Animate does not move itself).
 */
export function geometryStyle(
  graph: SceneGraph,
  node: SceneNode,
  state: LayerState,
  apart: ReadonlySet<string>
): GeometryStyle | null {
  if (!BOX_TYPES.has(node.type) || state.rotation !== 0) return null
  if (node.blendMode !== 'NORMAL' && node.blendMode !== 'PASS_THROUGH') return null
  if (!childrenDrawnApart(graph, node, apart)) return null
  const fills = node.fills.filter((fill) => fill.visible)
  const strokes = node.strokes.filter((stroke) => stroke.visible)
  const effects = node.effects.filter((effect) => effect.visible)
  if (fills.length > 1 || fills.some((fill) => fill.type !== 'SOLID')) return null
  if (strokes.length > 1 || strokes.some((stroke) => stroke.type !== 'SOLID')) return null
  if (effects.some((effect) => effect.type !== 'DROP_SHADOW' && effect.type !== 'INNER_SHADOW'))
    return null
  const fill = fills.at(0)
  const stroke = strokes.at(0)
  const radii = cornerRadii(node, state)
  return {
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    radii,
    fill: fill ? colorToCSS({ ...fill.color, a: fill.color.a * fill.opacity }) : null,
    stroke: stroke
      ? {
          weight: stroke.weight,
          color: colorToCSS({ ...stroke.color, a: stroke.color.a * stroke.opacity }),
          align: STROKE_ALIGN[stroke.align]
        }
      : null,
    shadows: effects.map((effect) => ({
      x: effect.offset.x,
      y: effect.offset.y,
      blur: effect.radius,
      spread: effect.spread,
      color: colorToCSS(effect.color),
      inner: effect.type === 'INNER_SHADOW'
    })),
    opacity: state.opacity
  }
}

const TRANSPARENT = 'rgba(0, 0, 0, 0)'

/**
 * A geometry style as CSS for one keyframe, at `scale` CSS pixels per screen unit. A stroke is a
 * spread shadow on the side Figma draws it, so it never changes the box's size; both keyframes
 * of a tween list the same number of shadows, so the browser tweens them pairwise.
 */
export function geometryKeyframe(
  style: GeometryStyle,
  scale: number,
  shadowSlots = style.shadows.length
): Record<string, string> {
  const px = (value: number) => `${Math.round(value * scale * 100) / 100}px`
  const strokeShadows: string[] = []
  if (style.stroke) {
    const { weight, color, align } = style.stroke
    if (align === 'inside') strokeShadows.push(`inset 0px 0px 0px ${px(weight)} ${color}`)
    else if (align === 'outside') strokeShadows.push(`0px 0px 0px ${px(weight)} ${color}`)
    else
      strokeShadows.push(
        `inset 0px 0px 0px ${px(weight / 2)} ${color}`,
        `0px 0px 0px ${px(weight / 2)} ${color}`
      )
  }
  while (strokeShadows.length < 2) strokeShadows.push(`inset 0px 0px 0px 0px ${TRANSPARENT}`)
  const shadows = style.shadows.map(
    (shadow) =>
      `${shadow.inner ? 'inset ' : ''}${px(shadow.x)} ${px(shadow.y)} ${px(shadow.blur)} ${px(shadow.spread)} ${shadow.color}`
  )
  while (shadows.length < shadowSlots) shadows.push(`0px 0px 0px 0px ${TRANSPARENT}`)
  return {
    left: px(style.x),
    top: px(style.y),
    width: px(style.width),
    height: px(style.height),
    borderRadius: style.radii.map(px).join(' '),
    backgroundColor: style.fill ?? TRANSPARENT,
    boxShadow: [...strokeShadows, ...shadows].join(', '),
    opacity: String(style.opacity)
  }
}

/** Where an overlay sits on the screen it opens over, in screen units, as Figma places it. */
export function overlayOrigin(
  screen: { width: number; height: number },
  overlay: { width: number; height: number },
  position: OverlayState['position']
): Vector {
  const centreX = (screen.width - overlay.width) / 2
  const centreY = (screen.height - overlay.height) / 2
  switch (position) {
    case 'top':
      return { x: centreX, y: 0 }
    case 'bottom':
      return { x: centreX, y: screen.height - overlay.height }
    case 'left':
      return { x: 0, y: centreY }
    case 'right':
      return { x: screen.width - overlay.width, y: centreY }
    default:
      return { x: centreX, y: centreY }
  }
}
