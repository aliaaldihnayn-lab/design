import type { SceneGraph } from '@lawha/scene-graph'
import type { Color, Vector } from '@lawha/scene-graph/primitives'
import {
  resolveColorVariable,
  resolveNumberVariable,
  resolveVariable
} from '@lawha/scene-graph/variables'

import type { FigmaAPI, FigmaComponentNode, FigmaNodeProxy } from '#core/figma-api'

const WHITE: Color = { r: 1, g: 1, b: 1, a: 1 }
const FALLBACK_PRIMARY: Color = { r: 0.31, g: 0.27, b: 0.9, a: 1 }
const FALLBACK_TEXT: Color = { r: 0.09, g: 0.09, b: 0.11, a: 1 }
const FALLBACK_SURFACE: Color = { r: 1, g: 1, b: 1, a: 1 }
const FALLBACK_BORDER: Color = { r: 0.82, g: 0.82, b: 0.86, a: 1 }
const ERROR: Color = { r: 0.86, g: 0.15, b: 0.15, a: 1 }

const solid = (color: Color, opacity = 1) => [
  { type: 'SOLID' as const, color, opacity, visible: true }
]

/** A component set the build made: its name, id, and its variant property's values. */
export interface BuiltComponentSet {
  name: string
  id: string
  variants: number
  properties: string[]
}

interface Tokens {
  color: (name: string, fallback: Color) => { color: Color; variable: string | null }
  /** The scale's step nearest to `target` among `prefix/*`, or `target` when there is none. */
  number: (prefix: string, target: number) => { value: number; variable: string | null }
  /** A pill radius (999 or more) from the scale, when it has one. */
  full: { value: number; variable: string | null }
  family: string
  body: { size: number; weight: number }
}

/**
 * The tokens components are styled with: the variables of `collectionId` by name, resolved in
 * its default mode, so a set made later uses the design system as it stands. Without the
 * collection (or a token), components fall back to plain values left unbound.
 */
function tokens(graph: SceneGraph, collectionId: string | null): Tokens {
  const variables = [...graph.variables.values()].filter(
    (variable) => collectionId !== null && variable.collectionId === collectionId
  )
  const byName = new Map(variables.map((variable) => [variable.name, variable]))
  const color = (name: string, fallback: Color) => {
    const variable = byName.get(name)
    const value = variable ? resolveColorVariable(graph, variable.id) : undefined
    return value && variable
      ? { color: value, variable: variable.id }
      : { color: fallback, variable: null }
  }
  const numbers = (prefix: string) =>
    variables.flatMap((variable) => {
      if (!variable.name.startsWith(`${prefix}/`)) return []
      const value = resolveNumberVariable(graph, variable.id)
      return value === undefined ? [] : [{ value, variable: variable.id }]
    })
  // The scale's step nearest to what a control wants, so components use the design's own values.
  const number = (prefix: string, target: number) =>
    numbers(prefix)
      .filter((step) => step.value < 999)
      .sort((a, b) => Math.abs(a.value - target) - Math.abs(b.value - target))
      .at(0) ?? { value: target, variable: null }
  const full = numbers('radius').find((step) => step.value >= 999) ?? {
    value: 999,
    variable: null
  }
  const read = (name: string) => {
    const variable = byName.get(name)
    return variable ? resolveVariable(graph, variable.id) : undefined
  }
  const family = read('font/primary')
  const size = read('type/body/size')
  const weight = read('type/body/weight')
  return {
    color,
    number,
    full,
    family: typeof family === 'string' ? family : 'Inter',
    body: {
      size: typeof size === 'number' ? size : 16,
      weight: typeof weight === 'number' ? weight : 400
    }
  }
}

/** Adds a text label, sized for its characters, bound to the label property when given. */
function label(
  graph: SceneGraph,
  parentId: string,
  text: string,
  t: Tokens,
  color: { color: Color; variable: string | null },
  weight = 600
): string {
  const size = t.body.size
  const node = graph.createNode('TEXT', parentId, {
    name: 'Label',
    text,
    fontFamily: t.family,
    fontSize: size,
    fontWeight: weight,
    width: Math.ceil(text.length * size * 0.6),
    height: Math.ceil(size * 1.4),
    textAutoResize: 'WIDTH_AND_HEIGHT',
    fills: solid(color.color)
  })
  if (color.variable) graph.bindVariable(node.id, 'fills/0/color', color.variable)
  return node.id
}

type Variant = Record<string, string>

const CORNERS = [
  'topLeftRadius',
  'topRightRadius',
  'bottomLeftRadius',
  'bottomRightRadius'
] as const
type ColorToken = { color: Color; variable: string | null }

/** Each badge tone's colour: the brand's, the text's, or a fixed red. */
const TONES: Record<string, (primary: ColorToken, text: ColorToken) => ColorToken> = {
  Brand: (primary) => primary,
  Neutral: (_primary, text) => text,
  Danger: () => ({ color: ERROR, variable: null })
}

function inputBorder(state: string, primary: Color, border: Color): Color {
  if (state === 'Error') return ERROR
  return state === 'Focus' ? primary : border
}

const variantName = (variant: Variant) =>
  Object.entries(variant)
    .map(([key, value]) => `${key}=${value}`)
    .join(', ')

/**
 * Combines components into a named set, then exposes `Label` as a text property every variant's
 * label follows, as a Figma button's label is.
 */
function combine(
  figma: FigmaAPI,
  parent: FigmaNodeProxy,
  name: string,
  components: FigmaComponentNode[],
  labelIds: string[],
  defaultLabel: string
): BuiltComponentSet {
  const set = figma.combineAsVariants(components, parent)
  set.name = name
  set.layoutMode = 'HORIZONTAL'
  set.layoutWrap = 'WRAP'
  set.itemSpacing = 24
  set.counterAxisSpacing = 24
  set.paddingTop = set.paddingBottom = set.paddingLeft = set.paddingRight = 24
  set.primaryAxisSizingMode = 'FIXED'
  set.counterAxisSizingMode = 'AUTO'
  set.resize(Math.min(components.length, 3) * 200 + 72, set.height)
  const key = set.addComponentProperty('Label', 'TEXT', defaultLabel)
  for (const id of labelIds) {
    // Text proxies take Figma's `componentPropertyReferences` setter, as scripts set it.
    const text = figma.getNodeById(id)
    if (text) Reflect.set(text, 'componentPropertyReferences', { characters: key })
  }
  return {
    name,
    id: set.id,
    variants: components.length,
    properties: Object.keys(set.componentPropertyDefinitions)
  }
}

/** The starter component sets, in the order they are laid out. */
export const COMPONENT_SET_NAMES = ['Button', 'Input', 'Badge'] as const
export type ComponentSetName = (typeof COMPONENT_SET_NAMES)[number]

/** Where component sets go and what they are styled with. */
export interface WriteComponentsOptions {
  /** The variable collection the sets bind to; null for plain values. */
  collectionId: string | null
  /** The sets to make; all of them by default. */
  sets?: readonly ComponentSetName[]
  /** Where the row of sets starts on the page. */
  origin: Vector
}

/**
 * Writes starter components onto a page, each a component set with variants, styled with the
 * collection's variables so they follow the tokens and their Light and Dark modes:
 * Button (Variant × State), Input (State) and Badge (Tone). The design system build calls it for
 * its docs page; it also runs on its own, on any page, whenever sets are wanted.
 */
export function writeComponents(
  figma: FigmaAPI,
  pageId: string,
  options: WriteComponentsOptions
): BuiltComponentSet[] {
  const graph = figma.graph
  const t = tokens(graph, options.collectionId)
  const wanted = new Set<ComponentSetName>(options.sets ?? COMPONENT_SET_NAMES)
  const found = figma.getNodeById(pageId)
  if (!found) throw new Error(`Page ${pageId} not found`)
  const page: FigmaNodeProxy = found
  const primary = t.color('color/primary', FALLBACK_PRIMARY)
  const text = t.color('color/text/primary', FALLBACK_TEXT)
  const muted = t.color('color/text/secondary', FALLBACK_TEXT)
  const surface = t.color('color/background', FALLBACK_SURFACE)
  const border = t.color('color/neutral/200', FALLBACK_BORDER)
  const radius = t.number('radius', 8)
  const padX = t.number('space', 20)
  const padY = t.number('space', 10)
  const gap = t.number('space', 8)

  const bindNumber = (id: string, field: string, token: { variable: string | null }) => {
    if (token.variable) graph.bindVariable(id, field, token.variable)
  }
  const bindPaint = (id: string, field: string, token: { variable: string | null }) => {
    if (token.variable) graph.bindVariable(id, field, token.variable)
  }

  /** A variant with auto layout; `tokens` binds its padding, gap and radius to the scale. */
  const component = (name: string, width: number, height: number, tokens = true) => {
    const node = figma.createComponent()
    page.appendChild(node)
    node.name = name
    node.resize(width, height)
    node.layoutMode = 'HORIZONTAL'
    node.primaryAxisAlignItems = 'CENTER'
    node.counterAxisAlignItems = 'CENTER'
    node.primaryAxisSizingMode = 'FIXED'
    node.counterAxisSizingMode = 'FIXED'
    graph.updateNode(node.id, {
      paddingLeft: padX.value,
      paddingRight: padX.value,
      paddingTop: padY.value,
      paddingBottom: padY.value,
      itemSpacing: gap.value,
      cornerRadius: radius.value
    })
    if (!tokens) return node
    for (const side of ['paddingLeft', 'paddingRight'] as const) bindNumber(node.id, side, padX)
    for (const side of ['paddingTop', 'paddingBottom'] as const) bindNumber(node.id, side, padY)
    bindNumber(node.id, 'itemSpacing', gap)
    for (const corner of CORNERS) bindNumber(node.id, corner, radius)
    return node
  }

  const sets: BuiltComponentSet[] = []
  const height = Math.max(40, Math.ceil(t.body.size * 1.4) + padY.value * 2)

  if (wanted.has('Button')) writeButtons()
  if (wanted.has('Input')) writeInputs()
  if (wanted.has('Badge')) writeBadges()

  // Button: Variant × State.
  function writeButtons() {
    const buttons: FigmaComponentNode[] = []
    const buttonLabels: string[] = []
    for (const variant of ['Primary', 'Secondary', 'Ghost'])
      for (const state of ['Default', 'Hover', 'Disabled']) {
        const node = component(variantName({ Variant: variant, State: state }), 160, height)
        if (variant === 'Primary') {
          graph.updateNode(node.id, { fills: solid(primary.color, state === 'Hover' ? 0.88 : 1) })
          bindPaint(node.id, 'fills/0/color', primary)
        } else {
          graph.updateNode(node.id, {
            fills: state === 'Hover' ? solid(primary.color, 0.1) : [],
            strokes:
              variant === 'Secondary'
                ? [{ ...solid(primary.color)[0], weight: 1.5, align: 'INSIDE' as const }]
                : []
          })
          if (state === 'Hover') bindPaint(node.id, 'fills/0/color', primary)
          if (variant === 'Secondary') bindPaint(node.id, 'strokes/0/color', primary)
        }
        if (state === 'Disabled') graph.updateNode(node.id, { opacity: 0.4 })
        const labelColor = variant === 'Primary' ? { color: WHITE, variable: null } : primary
        buttonLabels.push(label(graph, node.id, 'Button', t, labelColor))
        buttons.push(node)
      }
    sets.push(combine(figma, page, 'Button', buttons, buttonLabels, 'Button'))
  }

  // Input: State.
  function writeInputs() {
    const inputs: FigmaComponentNode[] = []
    const inputLabels: string[] = []
    for (const state of ['Default', 'Focus', 'Error', 'Disabled']) {
      const node = component(variantName({ State: state }), 280, height)
      node.primaryAxisAlignItems = 'MIN'
      graph.updateNode(node.id, {
        fills: solid(surface.color),
        strokes: [
          {
            ...solid(inputBorder(state, primary.color, border.color))[0],
            weight: state === 'Focus' ? 2 : 1,
            align: 'INSIDE' as const
          }
        ],
        opacity: state === 'Disabled' ? 0.5 : 1
      })
      bindPaint(node.id, 'fills/0/color', surface)
      if (state === 'Focus') bindPaint(node.id, 'strokes/0/color', primary)
      else if (state !== 'Error') bindPaint(node.id, 'strokes/0/color', border)
      inputLabels.push(label(graph, node.id, 'Placeholder', t, muted, t.body.weight))
      inputs.push(node)
    }
    sets.push(combine(figma, page, 'Input', inputs, inputLabels, 'Placeholder'))
  }

  // Badge: Tone, its padding and pill radius bound to the scale like the other controls'.
  function writeBadges() {
    const badgeX = t.number('space', 10)
    const badgeY = t.number('space', 4)
    const badges: FigmaComponentNode[] = []
    const badgeLabels: string[] = []
    for (const tone of ['Brand', 'Neutral', 'Danger']) {
      const node = component(
        variantName({ Tone: tone }),
        88,
        Math.ceil(t.body.size * 1.4) + 8,
        false
      )
      graph.updateNode(node.id, {
        paddingTop: badgeY.value,
        paddingBottom: badgeY.value,
        paddingLeft: badgeX.value,
        paddingRight: badgeX.value,
        cornerRadius: t.full.value
      })
      for (const side of ['paddingLeft', 'paddingRight'] as const) bindNumber(node.id, side, badgeX)
      for (const side of ['paddingTop', 'paddingBottom'] as const) bindNumber(node.id, side, badgeY)
      for (const corner of CORNERS) bindNumber(node.id, corner, t.full)
      const tint = TONES[tone](primary, text)
      graph.updateNode(node.id, { fills: solid(tint.color, 0.12) })
      bindPaint(node.id, 'fills/0/color', tint)
      badgeLabels.push(label(graph, node.id, tone, t, tint))
      badges.push(node)
    }
    sets.push(combine(figma, page, 'Badge', badges, badgeLabels, 'Badge'))
  }

  // Lay the sets out in a row, left to right.
  let x = options.origin.x
  for (const built of sets) {
    const set = figma.getNodeById(built.id)
    if (!set) continue
    set.x = x
    set.y = options.origin.y
    x += set.width + 80
  }
  return sets
}

/** Where new sets go on a page: below what it holds, so nothing is covered. */
export function componentsOrigin(graph: SceneGraph, pageId: string): Vector {
  const page = graph.getNode(pageId)
  let bottom = Number.NEGATIVE_INFINITY
  let left = Number.POSITIVE_INFINITY
  for (const id of page?.childIds ?? []) {
    const node = graph.getNode(id)
    if (!node || node.internalOnly) continue
    bottom = Math.max(bottom, node.y + node.height)
    left = Math.min(left, node.x)
  }
  return Number.isFinite(bottom) ? { x: left, y: bottom + 80 } : { x: 0, y: 0 }
}

/** The page named `name`, made at the end of the document when there is none. */
export function pageNamed(figma: FigmaAPI, name: string): string {
  const existing = figma.graph.getPages().find((page) => page.name === name)
  if (existing) return existing.id
  const page = figma.createPage()
  page.name = name
  return page.id
}
