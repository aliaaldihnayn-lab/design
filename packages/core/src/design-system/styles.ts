import type { SceneGraph } from '@lawha/scene-graph'
import { randomHex } from '@lawha/scene-graph/random'
import { getSharedStyles } from '@lawha/scene-graph/shared-styles'
import { pixelLength } from '@lawha/scene-graph/text'

import type { BuildResult } from './build'
import type { Plan } from './plan'

/** Where the system's text styles are named, as Figma groups styles by their path. */
export const TEXT_STYLE_PREFIX = 'Type/'

export interface TextStylesResult {
  /** Every style the build keeps, by name, with its style id. */
  styles: { name: string; id: string }[]
  created: number
  updated: number
  /** Text layers now using one of the styles. */
  linked: number
}

/**
 * Turns the type scale into shared text styles (Type/h1 … Type/body … Type/caption), as Figma's
 * local text styles: each holds its family, weight, size and line height, bound to the scale's
 * variables, and the text layers that used the values now use the style. Building again
 * updates the styles with the same names.
 */
export function writeTextStyles(
  graph: SceneGraph,
  pageId: string,
  plan: Plan,
  built: BuildResult
): TextStylesResult {
  const existing = new Map(getSharedStyles(graph, 'text').map((s) => [s.name, s]))
  const variableId = new Map(built.tokens.map((t) => [t.name, t.id]))
  const byName = new Map(
    [...graph.variables.values()]
      .filter((v) => v.collectionId === built.collection)
      .map((v) => [v.name, v.id])
  )
  const familyName = new Map(plan.families.map((f) => [f.family, f.name]))
  const result: TextStylesResult = { styles: [], created: 0, updated: 0, linked: 0 }
  for (const t of plan.type) {
    const name = `${TEXT_STYLE_PREFIX}${t.name}`
    const fields = {
      name,
      fontFamily: t.sample.family,
      fontWeight: t.sample.weight,
      fontSize: t.sample.size,
      lineHeight: t.sample.lineHeight === null ? null : pixelLength(t.sample.lineHeight)
    }
    const found = existing.get(name)
    let nodeId: string
    let styleId: string
    if (found) {
      graph.updateNode(found.nodeId, fields)
      nodeId = found.nodeId
      styleId = found.id
      result.updated++
    } else {
      const node = graph.createNode('TEXT', pageId, {
        ...fields,
        sharedStyleType: 'TEXT',
        internalOnly: true,
        visible: false
      })
      node.source.id = `style:${randomHex(12)}`
      nodeId = node.id
      styleId = node.source.id
      result.created++
    }
    const bindings: [string, string | undefined][] = [
      ['fontSize', variableId.get(`type/${t.name}`)],
      ['fontWeight', byName.get(`type/${t.name}/weight`)],
      ['lineHeight', byName.get(`type/${t.name}/line-height`)],
      ['fontFamily', variableId.get(familyName.get(t.sample.family) ?? '')]
    ]
    for (const [field, id] of bindings) if (id) graph.bindVariable(nodeId, field, id)
    for (const use of t.uses) {
      const layer = graph.getNode(use.node)
      if (layer?.type !== 'TEXT' || layer.textStyleId === styleId) continue
      graph.updateNode(use.node, { textStyleId: styleId })
      result.linked++
    }
    result.styles.push({ name, id: styleId })
  }
  return result
}
