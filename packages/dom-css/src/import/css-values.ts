import type { Fill, Stroke } from '@lawha/scene-graph'
import { parseCSSColor, parseCSSNumber } from '@lawha/scene-graph/css'

import type { DesignStyleDeclaration } from '../types'

export function colorToFillFromCSS(value: string | undefined): Fill[] {
  const color = parseCSSColor(value)
  if (!color) return []
  return [{ type: 'SOLID', color, opacity: color.a, visible: true }]
}

export function colorToStrokeFromCSS(
  colorValue: string | undefined,
  weightValue: string | undefined
): Stroke[] {
  const color = parseCSSColor(colorValue)
  const weight = parseCSSNumber(weightValue)
  if (!color || weight === null || weight <= 0) return []
  return [{ type: 'SOLID', color, weight, opacity: color.a, visible: true, align: 'INSIDE' }]
}

export function pickStyle(elementStyle: DesignStyleDeclaration | undefined, property: string) {
  return elementStyle?.[property]
}

export function mergedStyle(node: {
  inlineStyle?: DesignStyleDeclaration
  computedStyle?: DesignStyleDeclaration
}) {
  return { ...node.inlineStyle, ...node.computedStyle }
}

/** Whether a style draws or sizes a box of its own, so the element is a frame rather than text. */
export function hasBoxStyle(style: DesignStyleDeclaration): boolean {
  return [
    'aspect-ratio',
    'background-color',
    'border-color',
    'border-style',
    'border-width',
    'border-top-style',
    'border-top-width',
    'border-right-style',
    'border-right-width',
    'border-bottom-style',
    'border-bottom-width',
    'border-left-style',
    'border-left-width',
    'border-radius',
    'box-shadow',
    'display',
    'height',
    'padding',
    'padding-top',
    'padding-right',
    'padding-bottom',
    'padding-left',
    'padding-block',
    'padding-inline',
    'width',
    'min-width',
    'max-width',
    'min-height',
    'max-height',
    'object-fit',
    'overflow',
    'position',
    'top',
    'right',
    'bottom',
    'left',
    'flex-wrap',
    'align-self'
  ].some((property) => pickStyle(style, property) !== undefined)
}
