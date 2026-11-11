import type { SceneGraph, SceneNode } from '@lawha/scene-graph'
import { colorToHex } from '@lawha/scene-graph/color'
import type { Color } from '@lawha/scene-graph/primitives'

import type { FigmaAPI } from '#core/figma-api'

import type { BuildResult } from './build'
import type { Plan } from './plan'

export const DOCS_PAGE_NAME = 'Design System'

const INK: Color = { r: 0.09, g: 0.09, b: 0.11, a: 1 }
const MUTED: Color = { r: 0.42, g: 0.42, b: 0.47, a: 1 }
const solid = (color: Color) => [{ type: 'SOLID' as const, color, opacity: 1, visible: true }]

/**
 * Writes a page documenting the system: colour swatches, the type scale, spacing and radii.
 * Swatches and samples are bound to their variables, so the page updates with the tokens.
 * Building again replaces the page's contents.
 */
export function writeDocsPage(
  graph: SceneGraph,
  plan: Plan,
  built: BuildResult,
  labelFamily: string
): SceneNode {
  const page =
    graph.getPages().find((p) => p.name === DOCS_PAGE_NAME) ?? graph.addPage(DOCS_PAGE_NAME)
  // A copy: deleting a child edits the list being walked. Shared styles kept on the page stay,
  // so the layers using them keep their style.
  for (const id of page.childIds.slice()) if (!graph.getNode(id)?.internalOnly) graph.deleteNode(id)
  const variableId = new Map(built.tokens.map((t) => [t.name, t.id]))

  const label = (
    parent: string,
    text: string,
    x: number,
    y: number,
    size = 14,
    color = INK,
    width = 260
  ) =>
    graph.createNode('TEXT', parent, {
      name: text,
      text,
      x,
      y,
      width,
      height: Math.ceil(size * 1.4),
      fontSize: size,
      fontFamily: labelFamily,
      fills: solid(color),
      textAutoResize: 'HEIGHT'
    })
  const section = (title: string, y: number, height: number) => {
    const frame = graph.createNode('FRAME', page.id, {
      name: title,
      x: 0,
      y,
      width: 1200,
      height,
      fills: solid({ r: 1, g: 1, b: 1, a: 1 })
    })
    label(frame.id, title, 40, 32, 28, INK, 600)
    return frame
  }

  let y = 0
  // Colours: a grid of swatches, each bound to its variable.
  const perRow = 6
  const colorRows = Math.max(1, Math.ceil(plan.colors.length / perRow))
  const colors = section('Colors', y, 120 + colorRows * 190)
  plan.colors.forEach((token, i) => {
    const x = 40 + (i % perRow) * 186
    const top = 100 + Math.floor(i / perRow) * 190
    const swatch = graph.createNode('RECTANGLE', colors.id, {
      name: token.name,
      x,
      y: top,
      width: 170,
      height: 110,
      cornerRadius: 12,
      fills: solid(token.color),
      strokes: [
        {
          type: 'SOLID',
          color: { r: 0, g: 0, b: 0, a: 0.08 },
          opacity: 1,
          visible: true,
          weight: 1,
          align: 'INSIDE'
        }
      ]
    })
    const id = variableId.get(token.name)
    if (id) graph.updateNode(swatch.id, { boundVariables: { 'fills/0/color': id } })
    label(colors.id, token.name, x, top + 118, 13, INK, 170)
    label(colors.id, colorToHex(token.color), x, top + 140, 12, MUTED, 170)
  })
  y += colors.height + 40

  // Type scale: a sample of each style at its size and weight.
  const typeHeights = plan.type.map((t) => Math.ceil(t.sample.size * 1.4) + 40)
  const typeFrame = section('Typography', y, 120 + typeHeights.reduce((s, h) => s + h, 0))
  let ty = 100
  plan.type.forEach((t, i) => {
    label(
      typeFrame.id,
      `${t.name} · ${t.sample.family} ${t.sample.size}/${t.sample.lineHeight ?? 'auto'} · ${t.sample.weight}`,
      40,
      ty,
      12,
      MUTED,
      1100
    )
    const sample = graph.createNode('TEXT', typeFrame.id, {
      name: `type/${t.name}`,
      text: 'The quick brown fox · نص تجريبي للعرض',
      x: 40,
      y: ty + 18,
      width: 1100,
      height: Math.ceil(t.sample.size * 1.4),
      fontSize: t.sample.size,
      fontWeight: t.sample.weight,
      fontFamily: t.sample.family,
      fills: solid(INK),
      textAutoResize: 'HEIGHT'
    })
    const id = variableId.get(`type/${t.name}`)
    if (id) graph.updateNode(sample.id, { boundVariables: { fontSize: id } })
    ty += typeHeights[i]
  })
  y += typeFrame.height + 40

  // Spacing and radii: bars as long as each step, squares rounded by each radius.
  const steps = [...plan.spacing, ...plan.radius]
  const spacing = section('Spacing & radius', y, 120 + steps.length * 56)
  steps.forEach((token, i) => {
    const top = 100 + i * 56
    label(spacing.id, `${token.name} · ${token.value}`, 40, top + 8, 13, INK, 220)
    const isRadius = token.name.startsWith('radius/')
    const shape = graph.createNode('RECTANGLE', spacing.id, {
      name: token.name,
      x: 280,
      y: top,
      width: isRadius ? 40 : Math.min(Math.max(token.value, 2), 880),
      height: 40,
      cornerRadius: isRadius ? Math.min(token.value, 20) : 2,
      fills: solid({ r: 0.31, g: 0.27, b: 0.9, a: isRadius ? 0.18 : 0.85 })
    })
    const id = variableId.get(token.name)
    if (id && isRadius) graph.updateNode(shape.id, { boundVariables: { cornerRadius: id } })
  })
  return page
}

/**
 * Shows the colours in Dark mode beside the Light ones: a copy of the Colors section set to the
 * collection's Dark mode, without the hex labels, which name the light values.
 */
export function writeDarkPreview(
  figma: FigmaAPI,
  page: SceneNode,
  collectionId: string,
  darkModeId: string
): string | null {
  const colors = page.childIds
    .map((id) => figma.graph.getNode(id))
    .find((node) => node?.name === 'Colors')
  const source = colors ? figma.getNodeById(colors.id) : null
  if (!colors || !source) return null
  const copy = source.clone()
  copy.name = 'Colors · Dark'
  copy.x = colors.x + colors.width + 80
  copy.y = colors.y
  const collection = figma.variables.getVariableCollectionById(collectionId)
  if (collection) copy.setExplicitVariableModeForCollection(collection, darkModeId)
  for (const child of copy.children) if (child.name.startsWith('#')) child.remove()
  const title = copy.children.find((child) => child.name === 'Colors')
  if (title?.type === 'TEXT') {
    figma.graph.updateNode(title.id, { name: 'Colors · Dark', text: 'Colors · Dark' })
  }
  // The section's own surface and text follow the theme too, where the system has them.
  const variable = (name: string) =>
    figma.variables
      .getLocalVariables()
      .find((v) => v.variableCollectionId === collectionId && v.name === name)
  const background = variable('color/background')
  const text = variable('color/text/primary')
  if (background) figma.graph.bindVariable(copy.id, 'fills/0/color', background.id)
  if (text)
    for (const child of copy.children)
      if (child.type === 'TEXT') figma.graph.bindVariable(child.id, 'fills/0/color', text.id)
  return copy.id
}

/** Where the next block on the docs page goes: under everything already on it. */
export function docsPageBottom(graph: SceneGraph, page: SceneNode): number {
  let bottom = 0
  for (const id of page.childIds) {
    const node = graph.getNode(id)
    if (node && !node.internalOnly) bottom = Math.max(bottom, node.y + node.height)
  }
  return bottom
}
