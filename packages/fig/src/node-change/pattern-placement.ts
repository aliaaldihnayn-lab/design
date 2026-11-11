import type { Fill, SceneNode } from '@lawha/scene-graph'
import { LAWHA_PLUGIN_DATA, withPluginData } from '@lawha/scene-graph/plugin-data'
import type { Vector } from '@lawha/scene-graph/primitives'

/** A pattern fill's offset and turn, as the plugin data keeps them. */
interface PatternPlacement {
  offset?: Vector
  rotation?: number
}

/** A pattern fill with a kept offset and turn put back on it. */
function placedPattern(fill: Fill, placement: PatternPlacement): Fill {
  const placed = { ...fill }
  if (placement.offset) placed.patternOffset = { ...placement.offset }
  if (placement.rotation) placed.patternRotation = placement.rotation
  return placed
}

/** Fills with the offset and turn kept for each pattern fill by its index put back on it. */
export function withPatternPlacement(
  fills: Fill[],
  kept: Record<string, PatternPlacement> | undefined
): Fill[] {
  if (!kept) return fills
  return fills.map((fill, index) => {
    const key = String(index)
    if (fill.type !== 'PATTERN' || !Object.hasOwn(kept, key)) return fill
    return placedPattern(fill, kept[key])
  })
}

/** What of a pattern fill's placement needs keeping: an offset that moves, a turn that turns. */
function placementOf(fill: Fill): PatternPlacement | null {
  const placement: PatternPlacement = {}
  const offset = fill.patternOffset
  if (offset && (offset.x !== 0 || offset.y !== 0)) placement.offset = { ...offset }
  if (fill.patternRotation) placement.rotation = fill.patternRotation
  return placement.offset || placement.rotation ? placement : null
}

/** Keeps each pattern fill's offset and turn by fill index, which Figma's pattern paint lacks. */
export function applyPatternPlacementPluginData(node: SceneNode): void {
  const byIndex: Record<string, PatternPlacement> = {}
  node.fills.forEach((fill, index) => {
    const placement = fill.type === 'PATTERN' ? placementOf(fill) : null
    if (placement) byIndex[String(index)] = placement
  })
  node.pluginData = withPluginData(
    node.pluginData,
    LAWHA_PLUGIN_DATA.patternPlacement,
    Object.keys(byIndex).length > 0 ? byIndex : undefined
  )
}
