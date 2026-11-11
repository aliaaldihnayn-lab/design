import {
  deriveCSSName,
  explicitCSSName,
  gradientGeometry,
  gradientToCSS,
  sceneNodeToDesignDocument,
  type GradientGeometry
} from '@lawha/dom-css/export'
import type { SceneGraph, SceneNode } from '@lawha/scene-graph'
import { colorToCSS, colorToHex } from '@lawha/scene-graph/color'
import { layoutSizing } from '@lawha/scene-graph/layout'
import type { Color } from '@lawha/scene-graph/primitives'

/** A variable a value is bound to: its name, and the CSS custom property Dev Mode shows. */
export interface InspectVariable {
  name: string
  css: string
}

/** A colour as code shows it: `#RRGGBB`, its alpha, and the variable it is bound to. */
export interface InspectColor {
  hex: string
  opacity: number
  /** The colour with its opacity, as CSS writes it: hex when opaque, else `rgba()`. */
  css: string
  variable: InspectVariable | null
}

export type InspectPaint =
  | ({ kind: 'solid' } & InspectColor)
  | {
      kind: 'gradient'
      type: 'linear' | 'radial' | 'angular' | 'diamond'
      /** Each stop's colour, with the fill's opacity, and its position from 0 to 1. */
      stops: (Omit<InspectColor, 'variable'> & { position: number })[]
      /** Where the handles fall in the layer's unit square, and CSS's angle. */
      geometry: GradientGeometry
      /** The gradient as a CSS image, as the code export writes it. */
      cssImage: string
    }
  | { kind: 'image' }

export interface InspectShadow extends InspectColor {
  inner: boolean
  x: number
  y: number
  blur: number
  spread: number
}

export type InspectSizing = 'fixed' | 'hug' | 'fill'

/** What Dev Mode shows about a layer, in units every code target shares (px, 0–1 opacity). */
export interface InspectSpec {
  name: string
  /**
   * The layer's CSS as the HTML and JSX export writes it (`@lawha/dom-css`), with bound values
   * as `var(--token)`, in the order the export sets them.
   */
  css: [string, string][]
  type: SceneNode['type']
  x: number
  y: number
  width: number
  height: number
  rotation: number
  opacity: number
  /** Top left, top right, bottom right, bottom left; null when square. */
  radii: [number, number, number, number] | null
  fills: InspectPaint[]
  strokes: (InspectColor & { weight: number; align: 'inside' | 'center' | 'outside' })[]
  shadows: InspectShadow[]
  blur: number | null
  sizing: {
    width: InspectSizing
    height: InspectSizing
    minWidth: number | null
    maxWidth: number | null
    minHeight: number | null
    maxHeight: number | null
  }
  layout: {
    direction: 'row' | 'column'
    gap: number
    padding: [number, number, number, number]
    justify: 'start' | 'center' | 'end' | 'space-between'
    align: 'start' | 'center' | 'end' | 'stretch' | 'baseline'
    wrap: boolean
  } | null
  text: {
    content: string
    family: string
    weight: number
    italic: boolean
    size: number
    /** In px; null for Auto. */
    lineHeight: number | null
    letterSpacing: number
    align: 'left' | 'center' | 'right' | 'justify'
    color: InspectColor | null
  } | null
}

const GRADIENTS = {
  GRADIENT_LINEAR: 'linear',
  GRADIENT_RADIAL: 'radial',
  GRADIENT_ANGULAR: 'angular',
  GRADIENT_DIAMOND: 'diamond'
} as const

const round = (value: number) => Math.round(value * 100) / 100
const hex = (color: Color) => colorToHex(color).slice(0, 7).toUpperCase()

function variableOf(graph: SceneGraph, node: SceneNode, field: string): InspectVariable | null {
  const id = node.boundVariables[field]
  const variable = id ? graph.variables.get(id) : undefined
  if (!variable) return null
  return { name: variable.name, css: explicitCSSName(variable) ?? deriveCSSName(variable) }
}

function color(
  graph: SceneGraph,
  node: SceneNode,
  field: string,
  value: Color,
  opacity: number
): InspectColor {
  const alpha = round(value.a * opacity)
  return {
    hex: hex(value),
    opacity: alpha,
    css: alpha >= 1 ? hex(value) : colorToCSS({ ...value, a: alpha }),
    variable: variableOf(graph, node, field)
  }
}

function paints(graph: SceneGraph, node: SceneNode): InspectPaint[] {
  return node.fills.flatMap((fill, index): InspectPaint[] => {
    if (!fill.visible) return []
    if (fill.type === 'SOLID')
      return [
        { kind: 'solid', ...color(graph, node, `fills/${index}/color`, fill.color, fill.opacity) }
      ]
    if (fill.type in GRADIENTS)
      return [
        {
          kind: 'gradient',
          type: GRADIENTS[fill.type as keyof typeof GRADIENTS],
          stops: (fill.gradientStops ?? []).map((stop) => {
            const alpha = round(stop.color.a * fill.opacity)
            return {
              hex: hex(stop.color),
              opacity: alpha,
              css: alpha >= 1 ? hex(stop.color) : colorToCSS({ ...stop.color, a: alpha }),
              position: round(stop.position)
            }
          }),
          geometry: gradientGeometry(fill, node.width, node.height),
          cssImage: gradientToCSS(fill, node.width, node.height) ?? ''
        }
      ]
    return fill.type === 'IMAGE' ? [{ kind: 'image' }] : []
  })
}

const JUSTIFY = {
  MIN: 'start',
  CENTER: 'center',
  MAX: 'end',
  SPACE_BETWEEN: 'space-between'
} as const
const ALIGN = {
  MIN: 'start',
  CENTER: 'center',
  MAX: 'end',
  STRETCH: 'stretch',
  BASELINE: 'baseline'
} as const
const TEXT_ALIGN = { LEFT: 'left', CENTER: 'center', RIGHT: 'right', JUSTIFIED: 'justify' } as const
const SIZING = { FIXED: 'fixed', HUG: 'hug', FILL: 'fill' } as const

function radii(node: SceneNode): InspectSpec['radii'] {
  const corners: [number, number, number, number] = node.independentCorners
    ? [node.topLeftRadius, node.topRightRadius, node.bottomRightRadius, node.bottomLeftRadius]
    : [node.cornerRadius, node.cornerRadius, node.cornerRadius, node.cornerRadius]
  return corners.some((r) => r > 0) ? corners : null
}

/** Reads what Dev Mode's inspect panel shows about a layer; null when it does not exist. */
export function inspectLayer(graph: SceneGraph, nodeId: string): InspectSpec | null {
  const node = graph.getNode(nodeId)
  if (!node) return null
  const effects = node.effects.filter((effect) => effect.visible)
  const textFill = node.type === 'TEXT' ? paints(graph, node).find((p) => p.kind === 'solid') : null
  return {
    name: node.name,
    css: exportedCSS(graph, nodeId),
    type: node.type,
    x: round(node.x),
    y: round(node.y),
    width: round(node.width),
    height: round(node.height),
    rotation: round(node.rotation),
    opacity: round(node.opacity),
    radii: radii(node),
    fills: node.type === 'TEXT' ? [] : paints(graph, node),
    strokes: node.strokes.flatMap((stroke, index) =>
      stroke.visible && stroke.type === 'SOLID'
        ? [
            {
              ...color(graph, node, `strokes/${index}/color`, stroke.color, stroke.opacity),
              weight: stroke.weight,
              align: stroke.align.toLowerCase() as 'inside' | 'center' | 'outside'
            }
          ]
        : []
    ),
    shadows: effects.flatMap((effect, index) =>
      effect.type === 'DROP_SHADOW' || effect.type === 'INNER_SHADOW'
        ? [
            {
              ...color(graph, node, `effects/${index}/color`, effect.color, 1),
              inner: effect.type === 'INNER_SHADOW',
              x: effect.offset.x,
              y: effect.offset.y,
              blur: effect.radius,
              spread: effect.spread
            }
          ]
        : []
    ),
    blur: effects.find((effect) => effect.type === 'LAYER_BLUR')?.radius ?? null,
    sizing: {
      width: SIZING[layoutSizing(graph, node, 'HORIZONTAL')],
      height: SIZING[layoutSizing(graph, node, 'VERTICAL')],
      minWidth: node.minWidth,
      maxWidth: node.maxWidth,
      minHeight: node.minHeight,
      maxHeight: node.maxHeight
    },
    layout:
      node.layoutMode === 'HORIZONTAL' || node.layoutMode === 'VERTICAL'
        ? {
            direction: node.layoutMode === 'HORIZONTAL' ? 'row' : 'column',
            gap: node.itemSpacing,
            padding: [node.paddingTop, node.paddingRight, node.paddingBottom, node.paddingLeft],
            justify: JUSTIFY[node.primaryAxisAlign],
            align: ALIGN[node.counterAxisAlign],
            wrap: node.layoutWrap === 'WRAP'
          }
        : null,
    text:
      node.type === 'TEXT'
        ? {
            content: node.text,
            family: node.fontFamily,
            weight: node.fontWeight,
            italic: node.italic,
            size: node.fontSize,
            lineHeight: lineHeightPx(node),
            letterSpacing: round(
              node.letterSpacing.unit === 'PIXELS'
                ? node.letterSpacing.value
                : (node.letterSpacing.value / 100) * node.fontSize
            ),
            align: TEXT_ALIGN[node.textAlignHorizontal],
            color: textFill?.kind === 'solid' ? textFill : null
          }
        : null
  }
}

function lineHeightPx(node: SceneNode): number | null {
  const lh = node.lineHeight
  if (!lh) return null
  return round(lh.unit === 'PIXELS' ? lh.value : (lh.value / 100) * node.fontSize)
}

/** The declarations the code export gives the layer's own element. */
function exportedCSS(graph: SceneGraph, nodeId: string): [string, string][] {
  const root = sceneNodeToDesignDocument(graph, nodeId).children.at(0)
  if (root?.type !== 'element') return []
  return Object.entries(root.inlineStyle ?? {})
}
